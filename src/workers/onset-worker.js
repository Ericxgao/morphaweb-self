// Import essentia as a module
import { Essentia, EssentiaWASM } from 'essentia.js';
import { PolarFFTWASM } from '../../lib/polarFFT.module.js';
import { OnsetsWASM } from '../../lib/onsets.module.js';

let essentia = null;

// Initialize parameters
self.allowedParams = ['sampleRate', 'frameSize', 'hopSize', 'odfs', 'odfsWeights', 'sensitivity'];
self.params = {
    frameSize: 1024,
    hopSize: Math.floor(1024 * 0.25), // 25% of frameSize = 512
    sampleRate: 44100,
    sensitivity: 0.1, // 10% sensitivity
    odfs: ['hfc', 'complex'],
    odfsWeights: [0.8, 0.2] // 80% HFC, 20% Complex
};

// Global storage
self.signal = null;
self.polarFrames = null;
self.onsetPositions = null;

// Cache variables
self.cachedPolarFrames = null;
self.cachedOdfMatrix = null;
self.cachedParams = { 
    frameSize: self.params.frameSize,
    hopSize: self.params.hopSize,
    sampleRate: self.params.sampleRate,
    odfs: [...self.params.odfs],
    odfsWeights: [...self.params.odfsWeights]
};

// Initialize essentia
async function initEssentia() {
    try {
        const wasmModule = EssentiaWASM.EssentiaWASM;
        essentia = new Essentia(wasmModule);
    } catch (error) {
        console.error('Failed to initialize essentia:', error);
    }
}

function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

async function computeFFT() {
    // Check if cachedPolarFrames exists and parameters match
    if (
        self.cachedPolarFrames &&
        self.cachedParams.frameSize === self.params.frameSize &&
        self.cachedParams.hopSize === self.params.hopSize &&
        self.cachedParams.sampleRate === self.params.sampleRate
    ) {
        self.polarFrames = self.cachedPolarFrames;
        return;
    }

    // Skip FFT computation if only using HFC
    if (self.params.odfs.length === 1 && self.params.odfs[0] === 'hfc') {
        const frames = essentia.FrameGenerator(self.signal, self.params.frameSize, self.params.hopSize);
        const totalFrames = frames.size();
        
        // Create dummy polar frames with just the time domain signal
        self.polarFrames = [];
        for (let i = 0; i < totalFrames; i++) {
            self.polarFrames.push({
                index: i,
                magnitude: essentia.vectorToArray(frames.get(i)),
                phase: new Float32Array(self.params.frameSize).fill(0) // Dummy phase data
            });
        }
        
        frames.delete();
        return;
    }

    self.polarFrames = [];
    const numWorkers = navigator.hardwareConcurrency || 4;
    
    const frames = essentia.FrameGenerator(self.signal, self.params.frameSize, self.params.hopSize);
    const totalFrames = frames.size();
    const framesPerWorker = Math.ceil(totalFrames / numWorkers);
    
    const workerPromises = [];
    
    for (let i = 0; i < numWorkers; i++) {
        const startFrame = i * framesPerWorker;
        const endFrame = Math.min((i + 1) * framesPerWorker, totalFrames);
        const frameSlice = [];
        
        // Extract frames for this worker
        for (let j = startFrame; j < endFrame; j++) {
            frameSlice.push(essentia.vectorToArray(frames.get(j)));
        }
        
        workerPromises.push(new Promise((resolve) => {
            const worker = new Worker(
                new URL('./fft-worker.js', import.meta.url),
                { type: 'module' }
            );
            
            worker.onmessage = (e) => {
                if (e.data.error) {
                    console.error('FFT Worker error:', e.data.error);
                } else {
                    self.polarFrames.push(...e.data.frames);
                    console.log('finished fft');
                }
                worker.terminate();
                resolve();
            };
            
            worker.postMessage({
                frames: frameSlice,
                frameSize: self.params.frameSize,
                startIndex: startFrame
            });
        }));
    }
    
    await Promise.all(workerPromises);
    
    // Sort frames by original index
    self.polarFrames.sort((a, b) => a.index - b.index);
    frames.delete();

    // After computing polarFrames, cache it
    self.cachedPolarFrames = self.polarFrames;
    self.cachedParams.frameSize = self.params.frameSize;
    self.cachedParams.hopSize = self.params.hopSize;
    self.cachedParams.sampleRate = self.params.sampleRate;
}

async function computeOnsets() {
    // Check if odfMatrix is cached and odfs haven't changed
    if (
        self.cachedOdfMatrix &&
        arraysEqual(self.cachedParams.odfs, self.params.odfs)
    ) {
        var odfMatrix = self.cachedOdfMatrix;
    } else {
        const numWorkers = navigator.hardwareConcurrency || 4;
        const framesPerWorker = Math.ceil(self.polarFrames.length / numWorkers);
        
        // Process each ODF type in parallel
        const odfMatrixPromises = self.params.odfs.map(async (func) => {
            const workerPromises = [];
            
            for (let i = 0; i < numWorkers; i++) {
                const startFrame = i * framesPerWorker;
                const endFrame = Math.min((i + 1) * framesPerWorker, self.polarFrames.length);
                
                workerPromises.push(new Promise((resolve) => {
                    const worker = new Worker(
                        new URL('./odf-worker.js', import.meta.url),
                        { type: 'module' }
                    );
                    
                    worker.onmessage = (e) => {
                        if (e.data.error) {
                            console.error('ODF Worker error:', e.data.error);
                        }
                        resolve(e.data.odfValues);
                        worker.terminate();
                    };
                    
                    worker.postMessage({
                        frames: self.polarFrames.slice(startFrame, endFrame),
                        odfFunction: func,
                        sampleRate: self.params.sampleRate,
                        startIndex: startFrame
                    });
                }));
            }
            
            const results = await Promise.all(workerPromises);

            return results.reduce((acc, curr) => {
                acc.push(...curr);
                return acc;
            }, []);
        });
        
        odfMatrix = await Promise.all(odfMatrixPromises);

        for (let col = 0; col < odfMatrix[0].length; col++) {
            for (let row = 0; row < odfMatrix.length; row++) {
                odfMatrix[row][col] = odfMatrix[row][col].value.onsetDetection;
            }
        }

        // After computing odfMatrix, cache it
        self.cachedOdfMatrix = odfMatrix;
        self.cachedParams.odfs = [...self.params.odfs];
    }

    const alpha = 1 - self.params.sensitivity;

    // Proceed with onset detection using odfMatrix
    const Onsets = new OnsetsWASM.Onsets(alpha, 5, self.params.sampleRate / self.params.hopSize, 0.02);
    
    const onsetPositions = Onsets.compute(odfMatrix, self.params.odfsWeights).positions;

    Onsets.shutdown();
    
    if (onsetPositions.size() == 0) {
        return new Float32Array(0);
    } else {
        const positions = essentia.vectorToArray(onsetPositions).map(pos => Math.max(0, pos));

        console.log(positions);
        
        // const firstOnset = positions[0];
        // const nearZeroThreshold = 2; // Consider onsets within 2 frames as "near zero"
        // if (firstOnset > nearZeroThreshold) {
        //     positions.unshift(0);
        // }
        
        return positions.map(pos => Math.max(0, pos));
    }
}

function computeBPM() {
    if (!self.signal || !essentia) return null;
    
    try {
        // Use PercivalBpmEstimator with framed signal
        const bpm = essentia.PercivalBpmEstimator(
            essentia.arrayToVector(self.signal), 
            self.params.sampleRate,
            self.params.frameSize,
            self.params.hopSize
        );

        return Math.round(bpm.bpm);
    } catch (error) {
        console.error('Failed to compute BPM:', error);
        return null;
    }
}

// Initialize immediately
initEssentia();

self.onerror = function(error) {
    console.error('Onset Worker error:', error);
    self.postMessage({ error: error.message });
};

self.onmessage = async function(e) {
    const { type, audioData, sampleRate, params } = e.data;
    
    // Wait for essentia to be ready if it's not
    if (!essentia) {
        await new Promise(resolve => {
            const checkEssentia = () => {
                if (essentia) {
                    resolve();
                } else {
                    setTimeout(checkEssentia, 100);
                }
            };
            checkEssentia();
        });
    }

    try {
        switch (type) {
            case 'updateParams':
                if (params) {
                    const prevParams = { ...self.params };
                    self.params = { ...self.params, ...params };

                    // Determine if FFT or ODF needs to be recomputed
                    const needRecomputeFFT = 
                        self.params.frameSize !== prevParams.frameSize ||
                        self.params.hopSize !== prevParams.hopSize ||
                        self.params.sampleRate !== prevParams.sampleRate;

                    const needRecomputeODF = 
                        !arraysEqual(self.params.odfs, prevParams.odfs);
                    
                    if (needRecomputeFFT) {
                        // Invalidate cached FFT and ODF
                        self.cachedPolarFrames = null;
                        self.cachedOdfMatrix = null;
                        self.cachedParams.frameSize = self.params.frameSize;
                        self.cachedParams.hopSize = self.params.hopSize;
                        self.cachedParams.sampleRate = self.params.sampleRate;
                    } else if (needRecomputeODF) {
                        // Invalidate cached ODF
                        self.cachedOdfMatrix = null;
                        self.cachedParams.odfs = [...self.params.odfs];
                    }

                    // No need to invalidate if only sensitivity or odfsWeights changed
                }
                break;

            case 'processAudio':
                if (!(audioData instanceof Float32Array)) {
                    throw new Error('Audio data must be Float32Array');
                }
                console.log('Processing audio with params', self.params);
                self.signal = audioData;
                self.params.sampleRate = sampleRate;

                // Invalidate all caches when new audio is loaded
                self.cachedPolarFrames = null;
                self.cachedOdfMatrix = null;

                await computeFFT();
                const onsets = await computeOnsets();
                console.log('onsets computed')

                console.log(onsets);

                console.log('posting message')
                
                self.postMessage({ 
                    onsets: onsets,
                    bpm: 0,
                    success: true 
                });
                break;

            default:
                throw new Error('Unknown message type');
        }
    } catch (error) {
        console.error('Onset Worker error:', error);
        self.postMessage({ error: error.message });
    }
};
