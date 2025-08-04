import { WaveFile } from "wavefile";
import { saveAs } from "file-saver";

export default class WavHandler {
    constructor() {
        this.markers = []
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
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
        let file = new WaveFile()
        
        // Use 16-bit format for smaller file size (unless 32-bit is specifically needed)
        file.fromScratch(2, this.audioContext.sampleRate, '32f', buffer)

        // Filter and batch process markers to avoid redundant operations
        const validMarkers = markers.filter(marker => marker.position !== "top");
        
        // Add all cue points at once
        validMarkers.forEach(marker => {
            file.setCuePoint({
                position: marker.time * 1000
            });
        });

        // Optimize cue point processing
        if (file.cue && file.cue.points) {
            file.cue.points.forEach(point => {
                point.dwPosition = point.dwSampleOffset;
            });
        }

        // Use toBuffer() + Blob instead of toDataURI() for better performance
        const wavBuffer = file.toBuffer();
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });
        
        const filename = "export.wav"
        console.log('Saving file...')
        saveAs(blob, filename)
    }

    async createSampleDrumBuffer(buffer, markers) {
        console.log('Exporting audio... sample drum')
        let file = new WaveFile()
        file.fromScratch(2, this.audioContext.sampleRate, '16', buffer)

        // Use toBuffer() + Blob instead of toDataURI() for better performance
        const wavBuffer = file.toBuffer();
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });
        
        const filename = "export.wav"
        console.log('Saving file...')
        saveAs(blob, filename)
    }
}