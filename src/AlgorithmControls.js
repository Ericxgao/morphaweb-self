export default class AlgorithmControls {
    constructor(morphaweb) {
        this.morphaweb = morphaweb;
        this.createControls();
        this.initializeDefaultValues();
    }

    createControls() {
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'algorithm-controls';
        
        // Frame Size Slider
        const frameSizeControl = this.createSlider({
            id: 'frame-size',
            label: 'Frame Size',
            min: 512,
            max: 8192,
            value: 512,
            step: 512
        });

        // Hop Size Slider (as percentage of frame size)
        const hopSizeControl = this.createSlider({
            id: 'hop-size',
            label: 'Hop Size %',
            min: 5,
            max: 100,
            value: 50,
            step: 1
        });

        // Sensitivity Slider
        const sensitivityControl = this.createSlider({
            id: 'sensitivity',
            label: 'Sensitivity %',
            min: 1,
            max: 100,
            value: 65,
            step: 1
        });

        // ODF Ratio Slider
        const odfRatioControl = this.createSlider({
            id: 'odf-ratio',
            label: 'ODF Ratio',
            min: 0,
            max: 100,
            value: 85,
            step: 5,
            helpText: 'Higher values improve detection for percussive elements, lower values improve detection for pitch changes'
        });

        controlsContainer.appendChild(frameSizeControl);
        controlsContainer.appendChild(hopSizeControl);
        controlsContainer.appendChild(sensitivityControl);
        controlsContainer.appendChild(odfRatioControl);

        // Insert controls before the existing controls
        const existingControls = document.querySelector('.controls');
        existingControls.insertBefore(controlsContainer, existingControls.firstChild);
    }

    createSlider({ id, label, min, max, value, step, helpText }) {
        const container = document.createElement('div');
        container.className = 'slider-container';

        // Create a div to wrap the controls
        const controlsWrapper = document.createElement('div');
        controlsWrapper.className = 'slider-controls';

        const labelElement = document.createElement('label');
        labelElement.htmlFor = id;
        labelElement.textContent = label;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = id;
        slider.min = min;
        slider.max = max;
        slider.value = value;
        slider.step = step;
        
        // Calculate and set the initial position percentage
        const percentage = ((value - min) / (max - min)) * 100;
        slider.style.setProperty('--value', percentage + '%');

        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'slider-value';
        valueDisplay.textContent = Number(value).toFixed(String(step).split('.')[1]?.length || 0);

        slider.addEventListener('input', (e) => {
            // Update the position when slider moves
            const percentage = ((e.target.value - min) / (max - min)) * 100;
            slider.style.setProperty('--value', percentage + '%');
            valueDisplay.textContent = Number(slider.value).toFixed(String(step).split('.')[1]?.length || 0);
            this.handleSliderChange();
        });

        // Add elements to the controls wrapper
        controlsWrapper.appendChild(labelElement);
        controlsWrapper.appendChild(slider);
        controlsWrapper.appendChild(valueDisplay);
        
        // Add controls wrapper to main container
        container.appendChild(controlsWrapper);

        // Add help text if provided
        if (helpText) {
            const helpElement = document.createElement('div');
            helpElement.className = 'slider-help-text';
            helpElement.textContent = helpText;
            container.appendChild(helpElement);
        }

        return container;
    }

    handleSliderChange() {
        const frameSize = parseInt(document.getElementById('frame-size').value);
        const hopSizePercent = parseInt(document.getElementById('hop-size').value);
        const sensitivity = parseFloat(document.getElementById('sensitivity').value);
        const odfRatio = parseInt(document.getElementById('odf-ratio').value);

        const hopSize = Math.floor(frameSize * (hopSizePercent / 100));
        const hfcWeight = odfRatio / 100;
        const complexWeight = 1 - hfcWeight;

        let odfs, odfsWeights;
        
        if (odfRatio === 0) {
            // Use only complex
            odfs = ['complex'];
            odfsWeights = [1];
        } else if (odfRatio === 100) {
            // Use only HFC
            odfs = ['hfc'];
            odfsWeights = [1];
        } else {
            // Use both with weights
            odfs = ['hfc', 'complex'];
            odfsWeights = [hfcWeight, complexWeight];
        }

        const params = {
            frameSize,
            hopSize,
            sensitivity: sensitivity / 100.0,
            odfs,
            odfsWeights
        };

        if (this.morphaweb.onsetHandler) {
            this.morphaweb.onsetHandler.worker.postMessage({
                type: 'updateParams',
                params
            });
        }
    }

    initializeDefaultValues() {
        // Set initial values - use setTimeout to ensure DOM elements are ready
        setTimeout(() => {
            const odfRatioElement = document.getElementById('odf-ratio');
            if (odfRatioElement) {
                this.handleSliderChange();
            } else {
                console.error('ODF Ratio slider not found in DOM');
            }
        }, 0);
    }
} 