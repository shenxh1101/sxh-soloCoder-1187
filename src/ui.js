export function initUI(callbacks) {
    const {
        onStart, onPause, onStop, onReset,
        onSpeedChange, onPresetSelect, onFileUpload, onGifExport
    } = callbacks;

    document.getElementById('btn-start').addEventListener('click', () => {
        const btn = document.getElementById('btn-start');
        if (btn.textContent.includes('继续')) {
            onStart();
        } else {
            onStart();
        }
    });

    document.getElementById('btn-pause').addEventListener('click', () => onPause());

    document.getElementById('btn-stop').addEventListener('click', () => onStop());

    document.getElementById('btn-reset').addEventListener('click', () => onReset());

    document.getElementById('speed-slider').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        onSpeedChange(val);
    });

    document.querySelectorAll('.preset-item').forEach(item => {
        item.addEventListener('click', () => {
            const preset = item.dataset.preset;
            onPresetSelect(preset);
        });
    });

    const fileUpload = document.getElementById('file-upload');
    const fileInput = document.getElementById('file-input');

    fileUpload.addEventListener('click', () => fileInput.click());
    fileUpload.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileUpload.classList.add('dragover');
    });
    fileUpload.addEventListener('dragleave', () => {
        fileUpload.classList.remove('dragover');
    });
    fileUpload.addEventListener('drop', (e) => {
        e.preventDefault();
        fileUpload.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) onFileUpload(file);
    });
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) onFileUpload(file);
    });

    document.getElementById('btn-export-gif').addEventListener('click', () => onGifExport());

    document.getElementById('layer-height').addEventListener('change', () => onReset());
    document.getElementById('exposure-time').addEventListener('change', () => onReset());
}

export function updateProgressUI(progress, currentLayer, totalLayers) {
    document.getElementById('progress-bar').style.width = `${progress}%`;
    document.getElementById('stat-progress').textContent = `${progress}%`;
    document.getElementById('stat-layers').textContent = `${currentLayer}/${totalLayers}`;
}

export function updateStatus(status, customText) {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');

    dot.className = `status-dot ${status}`;

    if (customText) {
        text.textContent = customText;
    } else {
        switch (status) {
            case 'idle': text.textContent = '就绪'; break;
            case 'printing': text.textContent = '打印中...'; break;
            case 'paused': text.textContent = '已暂停'; break;
            case 'complete': text.textContent = '打印完成 ✓'; break;
            case 'error': text.textContent = '错误'; break;
            default: text.textContent = status;
        }
    }
}

export function updateButtonStates(state) {
    const btnStart = document.getElementById('btn-start');
    const btnPause = document.getElementById('btn-pause');
    const btnStop = document.getElementById('btn-stop');
    const btnReset = document.getElementById('btn-reset');
    const btnExportGif = document.getElementById('btn-export-gif');
    const speedSlider = document.getElementById('speed-slider');

    switch (state) {
        case 'idle':
            btnStart.textContent = '▶ 开始打印';
            btnStart.className = 'btn btn-primary';
            btnStart.disabled = false;
            btnPause.disabled = true;
            btnPause.textContent = '⏸ 暂停';
            btnStop.disabled = true;
            btnReset.disabled = true;
            btnExportGif.disabled = true;
            speedSlider.disabled = false;
            break;
        case 'ready':
            btnStart.textContent = '▶ 开始打印';
            btnStart.className = 'btn btn-primary';
            btnStart.disabled = false;
            btnPause.disabled = true;
            btnPause.textContent = '⏸ 暂停';
            btnStop.disabled = true;
            btnReset.disabled = false;
            btnExportGif.disabled = true;
            speedSlider.disabled = false;
            break;
        case 'printing':
            btnStart.textContent = '▶ 开始打印';
            btnStart.className = 'btn btn-primary';
            btnStart.disabled = true;
            btnPause.disabled = false;
            btnPause.textContent = '⏸ 暂停';
            btnStop.disabled = true;
            btnReset.disabled = false;
            btnExportGif.disabled = true;
            speedSlider.disabled = false;
            break;
        case 'paused':
            btnStart.textContent = '▶ 继续';
            btnStart.className = 'btn btn-primary';
            btnStart.disabled = false;
            btnPause.disabled = true;
            btnPause.textContent = '⏸ 暂停';
            btnStop.disabled = false;
            btnReset.disabled = false;
            btnExportGif.disabled = true;
            speedSlider.disabled = false;
            break;
        case 'complete':
            btnStart.disabled = true;
            btnStart.textContent = '▶ 开始打印';
            btnPause.disabled = true;
            btnStop.disabled = true;
            btnReset.disabled = false;
            btnExportGif.disabled = false;
            speedSlider.disabled = false;
            break;
    }
}

export function updateRemainingTime(timeStr) {
    document.getElementById('stat-time').textContent = timeStr;
}

export function setGifProgress(percent) {
    const container = document.getElementById('gif-progress');
    const bar = document.getElementById('gif-bar-inner');
    container.style.display = 'block';
    bar.style.width = `${percent}%`;
    if (percent >= 100) {
        setTimeout(() => {
            container.style.display = 'none';
            bar.style.width = '0%';
        }, 2000);
    }
}