import { WaveFile } from "wavefile";
import { saveAs } from "file-saver";

export default class WavHandler {
    constructor() {
        this.markers = []
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Fast export using direct ArrayBuffer manipulation - adapted from optimized implementation
    audioBufferToWavFormat(buffer, format, markerTimes) {
        // Convert your channel array format to AudioBuffer if needed
        let audioBuffer;
        if (Array.isArray(buffer)) {
            const numChannels = buffer.length;
            const length = buffer[0].length;
            audioBuffer = this.audioContext.createBuffer(numChannels, length, this.audioContext.sampleRate);
            
            for (let channel = 0; channel < numChannels; channel++) {
                const channelData = audioBuffer.getChannelData(channel);
                for (let i = 0; i < length; i++) {
                    channelData[i] = buffer[channel][i];
                }
            }
        } else {
            audioBuffer = buffer; // Already an AudioBuffer
        }

        const originalSampleRate = audioBuffer.sampleRate;
        const originalChannels = audioBuffer.numberOfChannels;
        let processedBuffer = audioBuffer;

        // Handle sample rate conversion if needed
        if (originalSampleRate !== format.sampleRate) {
            const resampleRatio = format.sampleRate / originalSampleRate;
            const newLength = Math.round(audioBuffer.length * resampleRatio);

            processedBuffer = this.audioContext.createBuffer(
                originalChannels,
                newLength,
                format.sampleRate
            );

            for (let channel = 0; channel < originalChannels; channel++) {
                const originalData = audioBuffer.getChannelData(channel);
                const newData = processedBuffer.getChannelData(channel);

                // Simple linear interpolation resampling
                for (let i = 0; i < newLength; i++) {
                    const originalIndex = i / resampleRatio;
                    const index = Math.floor(originalIndex);
                    const fraction = originalIndex - index;

                    if (index < originalData.length - 1) {
                        newData[i] = originalData[index] * (1 - fraction) + originalData[index + 1] * fraction;
                    } else if (index < originalData.length) {
                        newData[i] = originalData[index];
                    } else {
                        newData[i] = 0;
                    }
                }
            }
        }

        // Handle channel conversion (stereo to mono if needed)
        let finalBuffer = processedBuffer;
        const targetChannels = format.channels === 'mono' ? 1 : Math.min(processedBuffer.numberOfChannels, 2);

        if (format.channels === 'mono' && processedBuffer.numberOfChannels > 1) {
            finalBuffer = this.audioContext.createBuffer(1, processedBuffer.length, format.sampleRate);

            const monoData = finalBuffer.getChannelData(0);
            const leftData = processedBuffer.getChannelData(0);
            const rightData = processedBuffer.numberOfChannels > 1 ? processedBuffer.getChannelData(1) : leftData;

            // Mix down to mono by averaging left and right channels
            for (let i = 0; i < processedBuffer.length; i++) {
                monoData[i] = (leftData[i] + rightData[i]) * 0.5;
            }
        }

        // Now convert to WAV format with the specified bit depth
        const length = finalBuffer.length;
        const numberOfChannels = targetChannels;
        const sampleRate = format.sampleRate;
        const bitsPerSample = format.bitDepth;
        const bytesPerSample = bitsPerSample / 8;
        const blockAlign = numberOfChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = length * blockAlign;

        // Calculate cue chunk size if we have markers
        const hasCues = markerTimes.length > 0;
        const cueChunkSize = hasCues ? 12 + markerTimes.length * 24 : 0;
        const bufferSize = 44 + dataSize + cueChunkSize;

        const arrayBuffer = new ArrayBuffer(bufferSize);
        const view = new DataView(arrayBuffer);

        // WAV header
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, bufferSize - 8, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format.format === 'float' ? 3 : 1, true); // 3 for float, 1 for int
        view.setUint16(22, numberOfChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);

        // Convert samples based on format
        let offset = 44;
        for (let i = 0; i < length; i++) {
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const channelIndex = Math.min(channel, finalBuffer.numberOfChannels - 1);
                const sample = finalBuffer.getChannelData(channelIndex)[i];

                if (format.format === 'float' && format.bitDepth === 32) {
                    view.setFloat32(offset, sample, true);
                    offset += 4;
                } else if (format.bitDepth === 16) {
                    const intSample = Math.max(-1, Math.min(1, sample)) * 0x7fff;
                    view.setInt16(offset, intSample, true);
                    offset += 2;
                }
            }
        }

        // Add cue points if any - adapted to work with your marker format
        if (hasCues) {
            writeString(offset, 'cue ');
            offset += 4;
            view.setUint32(offset, cueChunkSize - 8, true);
            offset += 4;
            view.setUint32(offset, markerTimes.length, true);
            offset += 4;

            // Convert marker times to sample positions in the exported format
            for (let i = 0; i < markerTimes.length; i++) {
                const cueTime = markerTimes[i];
                const resampleRatio = format.sampleRate / originalSampleRate;
                const cueSample = Math.floor(cueTime * originalSampleRate * resampleRatio);

                view.setUint32(offset, i, true); // Cue point ID
                view.setUint32(offset + 4, cueSample, true); // Play order position
                writeString(offset + 8, 'data'); // Data chunk ID
                view.setUint32(offset + 12, 0, true); // Chunk start
                view.setUint32(offset + 16, 0, true); // Block start
                view.setUint32(offset + 20, cueSample, true); // Sample offset
                offset += 24;
            }
        }

        return arrayBuffer;
    }

    // Fast download method
    fastDownload(arrayBuffer, filename = 'morphedit-export.wav') {
        const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async getMarkersFromFile(file) {
        return new Promise((resolve, reject) => {
            let fr = new FileReader()
            let cues = []
            fr.readAsDataURL(file)
            fr.onloadend = () => {
                // Check if file is MP3 or WAV
                if (file.type === 'audio/wav' || file.type === 'audio/wave' || file.type === 'audio/x-wav') {
                    let f = new WaveFile()
                    const base64String = fr.result
                        .replace("data:", "")
                        .replace(/^.+,/, "");
                    f.fromBase64(base64String)
                    cues = f.listCuePoints()
                    resolve(cues)
                } else {
                    // For MP3s, we won't have cue points initially
                    resolve([])
                }
            }
            fr.onerror = reject
        })
    }

    async createFileFromBuffer(buffer, markers) {
        console.log('Exporting audio...')
        
        // Filter and extract marker times - adapted from your existing logic
        const validMarkers = markers.filter(marker => marker.position !== "top");
        const markerTimes = validMarkers.map(marker => marker.time);
        
        // Use fast export with 16-bit format for smaller file size
        const format = {
            sampleRate: this.audioContext.sampleRate,
            bitDepth: 16,
            channels: 'stereo',
            format: 'int'
        };
        
        const arrayBuffer = this.audioBufferToWavFormat(buffer, format, markerTimes);
        
        const filename = "export.wav"
        console.log('Saving file...')
        this.fastDownload(arrayBuffer, filename)
    }

    async createSampleDrumBuffer(buffer, markers) {
        console.log('Exporting audio... sample drum')
        
        // Use fast export with 16-bit format (no markers for drum export)
        const format = {
            sampleRate: this.audioContext.sampleRate,
            bitDepth: 16,
            channels: 'stereo',
            format: 'int'
        };
        
        const arrayBuffer = this.audioBufferToWavFormat(buffer, format, []);
        
        const filename = "export.wav"
        console.log('Saving file...')
        this.fastDownload(arrayBuffer, filename)
    }
}