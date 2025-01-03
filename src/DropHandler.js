import Crunker from 'crunker'
export default class DropHandler {
    constructor(morphaweb) {
        this.morphaweb = morphaweb
        this.overlay = document.getElementById("overlay")
        this.messageOverlay = document.getElementById("message-overlay")
        this.messageText = document.getElementById("message-text")
        this.crunker = new Crunker({sampleRate:48000})
        
        document.addEventListener("dragover", this.allowDrop.bind(this))
        document.addEventListener("drop", this.onDrop.bind(this))
    }

    allowDrop(e) {
        this.overlayShow()
        e.preventDefault()
    }

    showMessage(text, duration = 10000) {
        this.messageText.textContent = text;
        this.messageOverlay.classList.add('show');
        
        setTimeout(() => {
            this.messageOverlay.classList.remove('show');
        }, duration);
    }

    async loadFiles(files) {
        const MAX_DURATION_SECONDS = 174; // 2.9 minutes in seconds
        
        let audioBuffers = []
        let audioCtx = new AudioContext()
        let markers = []
        let offset = 0
        const fileArray = [...files]
        const promise = fileArray.map(async file => {
            console.log(file)
            await file.arrayBuffer().then(async buf => {
                console.log(`Number of channels: ${buf.length}`);
                const p = await audioCtx.decodeAudioData(buf).then(async buf => {
                    if (buf.duration > MAX_DURATION_SECONDS) {
                        const truncatedBuffer = audioCtx.createBuffer(
                            buf.numberOfChannels,
                            Math.floor(MAX_DURATION_SECONDS * buf.sampleRate),
                            buf.sampleRate
                        );
                        
                        for (let channel = 0; channel < buf.numberOfChannels; channel++) {
                            truncatedBuffer.copyToChannel(
                                buf.getChannelData(channel).slice(0, Math.floor(MAX_DURATION_SECONDS * buf.sampleRate)),
                                channel
                            );
                        }
                        
                        this.showMessage(`Audio file longer than ${MAX_DURATION_SECONDS/60} minutes. It has been truncated.`);
                        buf = truncatedBuffer;
                    }

                    let m = await this.morphaweb.wavHandler.getMarkersFromFile(file)
                    m = m.map((mm,i) => {
                        mm.position += offset
                        return mm
                    })
                    markers.push(...m)
                    // add marker between multiple files
                    markers.push({position: buf.duration*1000})
                    offset += buf.duration*1000
                    audioBuffers.push(buf)
                },() => {
                    this.morphaweb.track("ErrorFileUploadMarkers")
                })
                return p;
            }, () => {
                this.morphaweb.track("ErrorFileUpload")
            })
        })
        const resolvedPromises = await Promise.all(promise)
        markers.pop()
        const concatted = this.crunker.concatAudio(audioBuffers)
        const ex = this.crunker.export(concatted,"audio/wav")
        const obj = {
            blob: ex.blob,
            markers: markers
        }
        return obj
    }
    
    onDrop(e) {
        e.preventDefault()
        this.overlayHide()
        this.morphaweb.wavesurfer.clearMarkers()
        this.loadFiles(e.dataTransfer.files).then(res => {
            this.morphaweb.wavesurfer.loadBlob(res.blob)
            this.morphaweb.wavHandler.markers = res.markers
        })
    }


    overlayShow() {
        this.overlay.style.display = 'block'
    }

    overlayHide() {
        this.overlay.style.display = 'none'
    }
}