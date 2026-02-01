document.addEventListener("DOMContentLoaded", function(event) {

    // 1. Initialize Audio Context
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContext();
    window.audioCtx = audioCtx;

    let currentWaveform = 'sine';
    const activeOscillators = {};

    // --- VISUALIZER SETUP ---
    const canvas = document.getElementById("bg-visualizer");
    const canvasCtx = canvas.getContext("2d");
    
    // Resize canvas to full screen
    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();  
 
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048; 
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    let currentHue = 200; 
    let targetHue = 200;

    // 2. Global Gain (Master Volume)
    const globalGain = audioCtx.createGain();
    
    // CONSTRAINT 1: Keep amplitude low (< 1) to allow polyphony without clipping
    globalGain.gain.setValueAtTime(0.2, audioCtx.currentTime); 
    
    // WIRE UP: Master -> Analyser -> Speakers
    globalGain.connect(analyser);
    analyser.connect(audioCtx.destination);

    // 3. ADSR Parameters
    const attackTime = 0.05;
    const decayTime = 0.1;
    const sustainLevel = 0.7; // Sustain volume relative to peak (0 to 1)
    const releaseTime = 0.5;

    // Frequency Map
    const keyboardFrequencyMap = {
        '90': 261.63, '83': 277.18, '88': 293.66, '68': 311.13,
        '67': 329.63, '86': 349.23, '71': 369.99, '66': 392.00,
        '72': 415.30, '78': 440.00, '74': 466.16, '77': 493.88,
        '81': 523.25, '50': 554.37, '87': 587.33, '51': 622.25,
        '69': 659.26, '82': 698.46, '53': 739.99, '84': 783.99,
        '54': 830.61, '89': 880.00, '55': 932.33, '85': 987.77,
        '73': 1046.50, '57': 1108.73, '79': 1174.66
    };

    // Waveform Selector
    const waveformSelector = document.getElementById('waveform');
    if(waveformSelector){
        waveformSelector.addEventListener('change', function(e) {
            currentWaveform = e.target.value;
        });
    }

    // --- DRAW FUNCTION (Visualizer Loop) ---
    function draw() {
        requestAnimationFrame(draw);

        analyser.getByteTimeDomainData(dataArray);

        // Clear canvas (background color matches CSS body slightly transparent)
        canvasCtx.fillStyle = 'rgba(26, 37, 47, 0.3)'; 
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

        canvasCtx.lineWidth = 3;
        
        // Color transition logic
        currentHue = currentHue + (targetHue - currentHue) * 0.1;
        canvasCtx.strokeStyle = `hsl(${currentHue}, 80%, 60%)`;
        canvasCtx.shadowBlur = 15;
        canvasCtx.shadowColor = `hsl(${currentHue}, 80%, 60%)`;

        canvasCtx.beginPath();

        const sliceWidth = canvas.width * 1.0 / bufferLength;
        let x = 0;

        for(let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0; 
            
            // Draw wave in top third of screen (height / 3) to sit above keyboard
            const y = (v * canvas.height / 3); 

            if(i === 0) {
                canvasCtx.moveTo(x, y);
            } else {
                canvasCtx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        canvasCtx.lineTo(canvas.width, canvas.height / 3);
        canvasCtx.stroke();
    }

    // Start drawing
    draw();

    // --- KEYDOWN ---
    window.addEventListener('keydown', keyDown, false);

    function keyDown(event) {
        // Resume context if suspended (browser policy)
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const key = event.keyCode.toString();
        // Check if key is valid and not already playing
        if (keyboardFrequencyMap[key] && !activeOscillators[key]) {
            playNote(key);
            highlightKey(key, true);
        }
    }

    // --- KEYUP ---
    window.addEventListener('keyup', keyUp, false);

    function keyUp(event) {
        const key = event.keyCode.toString();
        if (keyboardFrequencyMap[key] && activeOscillators[key]) {
            releaseNote(key);
            highlightKey(key, false);
        }
    }

    // --- PLAY NOTE (Attack, Decay, Sustain) ---
    function playNote(key) {
        const now = audioCtx.currentTime;
        const freq = keyboardFrequencyMap[key];

        // (Low=Red, High=Blue/Purple)
        targetHue = Math.min(300, Math.max(0, (freq - 200) / 3));

        const osc = audioCtx.createOscillator();
        const noteGain = audioCtx.createGain();

    
        osc.frequency.setValueAtTime(freq, now);
        osc.type = currentWaveform;

        // --- WIRE UP ---
        // 1. Oscillator feeds into Note Gain
        osc.connect(noteGain);
        // 2. Note Gain feeds into Global Master Gain
        noteGain.connect(globalGain); 

        // CONSTRAINT 3: Always start at 0 amplitude
        noteGain.gain.setValueAtTime(0, now); 

        // ATTACK: Linear Ramp to 1 (Max Volume for this note)
        noteGain.gain.linearRampToValueAtTime(1, now + attackTime);

        // DECAY: Exponential Ramp to Sustain Level
        noteGain.gain.exponentialRampToValueAtTime(sustainLevel, now + attackTime + decayTime);

        // Start Oscillator
        osc.start(now);
        activeOscillators[key] = { osc: osc, gain: noteGain };
    }

    // --- RELEASE NOTE ---
    function releaseNote(key) {
        if (!activeOscillators[key]) return;

        const now = audioCtx.currentTime;
        const { osc, gain } = activeOscillators[key];

        // 1. Cancel future ADSR events  
        gain.gain.cancelScheduledValues(now);

        // 2. Anchor the current volume (prevents sudden jumps)
        gain.gain.setValueAtTime(gain.gain.value, now);

        // 3.  setTargetAtTime
        // Decays asymptotically to 0. 
        // timeConstant = time it takes to decay by ~63%.
        // divide releaseTime by 5 to ensure it is silent by the end of the releaseTime.
        const timeConstant = releaseTime / 5;
        gain.gain.setTargetAtTime(0, now, timeConstant);

        // 4. Stop Oscillator
        // add a small buffer (+ 0.1s) to ensure the gain is truly zero before cutting the cord.
        osc.stop(now + releaseTime + 0.1);

        // 5. Cleanup memory
        // Disconnect nodes a bit after they stop
        setTimeout(() => {
            osc.disconnect();
            gain.disconnect();
        }, (releaseTime + 0.2) * 1000);

        delete activeOscillators[key];
    }


    function highlightKey(key, active) {
        const keyElement = document.querySelector(`[data-key="${key}"]`);
        if (keyElement) {
            if (active) keyElement.classList.add('active');
            else keyElement.classList.remove('active');
        }
    }

   
    document.querySelectorAll('.key, .black-key').forEach(key => {
        key.addEventListener('mousedown', function() {
            const keyCode = this.getAttribute('data-key');
            // Simulate KeyDown
            keyDown({ keyCode: keyCode });
        });
        
        key.addEventListener('mouseup', function() {
            const keyCode = this.getAttribute('data-key');
            // Simulate KeyUp
            keyUp({ keyCode: keyCode });
        });
        
        // Handle dragging off the key
        key.addEventListener('mouseleave', function() {
            const keyCode = this.getAttribute('data-key');
            if(activeOscillators[keyCode]) {
                keyUp({ keyCode: keyCode });
            }
        });
    });

});