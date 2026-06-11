export function initUI(callbacks) {
    const {
        onStart, onPause, onStop, onReset,
        onSpeedChange, onPresetSelect, onFileUpload, onExport,
        onTimelineChange, onTimelineRestore,
    } = callbacks;

    document.getElementById('btn-start').addEventListener('click', () => {
        onStart();
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

    const exportFormat = document.getElementById('export-format');
    document.getElementById('btn-export').addEventListener('click', () => {
        onExport(exportFormat.value);
    });

    const timelineSlider = document.getElementById('timeline-slider');
    let isDragging = false;

    timelineSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        onTimelineChange(val);
        isDragging = true;
    });

    timelineSlider.addEventListener('change', (e) => {
        isDragging = false;
        const val = parseInt(e.target.value);
        onTimelineChange(val);
    });

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
            case 'complete': text.textContent = '打印完成'; break;
            case 'error': text.textContent = '错误'; break;
            default: text.textContent = status;
        }
    }
}

export function updatePhaseStatus(phase) {
    const el = document.getElementById('phase-status');
    if (!el) return;
    switch (phase) {
        case 'lowering': el.textContent = '⬇ 平台下降中'; break;
        case 'exposure': el.textContent = '🔆 UV曝光中'; break;
        case 'lifting': el.textContent = '⬆ 平台抬升中'; break;
        case 'retraction': el.textContent = '↻ 回落等待中'; break;
        case 'raising': el.textContent = '⬆ 最终抬升中'; break;
        case 'paused': el.textContent = '⏸ 已暂停'; break;
        default: el.textContent = ''; break;
    }
}

export function updateTimelineMax(max) {
    const slider = document.getElementById('timeline-slider');
    const label = document.getElementById('timeline-label');
    if (slider) {
        slider.max = max;
        slider.value = max;
    }
    if (label && max > 0) {
        label.textContent = `第 ${max} 层（共 ${max} 层）`;
    } else if (label) {
        label.textContent = '暂无打印数据';
    }
}

export function updateTimelineValue(value) {
    const slider = document.getElementById('timeline-slider');
    const label = document.getElementById('timeline-label');
    if (slider) {
        slider.value = value;
    }
    if (label) {
        const max = slider ? parseInt(slider.max) : 0;
        label.textContent = `第 ${value} 层（共 ${max} 层）`;
    }
}

export function updateButtonStates(state) {
    const btnStart = document.getElementById('btn-start');
    const btnPause = document.getElementById('btn-pause');
    const btnStop = document.getElementById('btn-stop');
    const btnReset = document.getElementById('btn-reset');
    const btnExport = document.getElementById('btn-export');
    const speedSlider = document.getElementById('speed-slider');
    const timelineSection = document.getElementById('timeline-section');
    const timelineSlider = document.getElementById('timeline-slider');

    switch (state) {
        case 'idle':
            btnStart.textContent = '▶ 开始打印';
            btnStart.className = 'btn btn-primary';
            btnStart.disabled = false;
            btnPause.disabled = true;
            btnPause.textContent = '⏸ 暂停';
            btnStop.disabled = true;
            btnReset.disabled = true;
            btnExport.disabled = true;
            speedSlider.disabled = false;
            if (timelineSection) timelineSection.style.display = 'none';
            if (timelineSlider) timelineSlider.disabled = true;
            break;
        case 'ready':
            btnStart.textContent = '▶ 开始打印';
            btnStart.className = 'btn btn-primary';
            btnStart.disabled = false;
            btnPause.disabled = true;
            btnPause.textContent = '⏸ 暂停';
            btnStop.disabled = true;
            btnReset.disabled = false;
            btnExport.disabled = true;
            speedSlider.disabled = false;
            if (timelineSection) timelineSection.style.display = 'none';
            if (timelineSlider) timelineSlider.disabled = true;
            break;
        case 'printing':
            btnStart.textContent = '▶ 开始打印';
            btnStart.className = 'btn btn-primary';
            btnStart.disabled = true;
            btnPause.disabled = false;
            btnPause.textContent = '⏸ 暂停';
            btnStop.disabled = true;
            btnReset.disabled = false;
            btnExport.disabled = true;
            speedSlider.disabled = false;
            if (timelineSection) timelineSection.style.display = 'block';
            if (timelineSlider) {
                timelineSlider.disabled = true;
            }
            break;
        case 'paused':
            btnStart.textContent = '▶ 继续';
            btnStart.className = 'btn btn-primary';
            btnStart.disabled = false;
            btnPause.disabled = true;
            btnPause.textContent = '⏸ 暂停';
            btnStop.disabled = false;
            btnReset.disabled = false;
            btnExport.disabled = true;
            speedSlider.disabled = false;
            if (timelineSection) timelineSection.style.display = 'block';
            if (timelineSlider) {
                timelineSlider.disabled = false;
            }
            break;
        case 'complete':
            btnStart.disabled = true;
            btnStart.textContent = '▶ 开始打印';
            btnPause.disabled = true;
            btnStop.disabled = true;
            btnReset.disabled = false;
            btnExport.disabled = false;
            speedSlider.disabled = false;
            if (timelineSection) timelineSection.style.display = 'block';
            if (timelineSlider) {
                timelineSlider.disabled = false;
            }
            break;
    }
}

export function updateRemainingTime(timeStr) {
    document.getElementById('stat-time').textContent = timeStr;
}

export function setExportProgress(percent, statusText) {
    const container = document.getElementById('export-progress');
    const bar = document.getElementById('export-bar-inner');
    const text = document.getElementById('export-progress-text');
    if (!container) return;
    container.style.display = 'block';
    bar.style.width = `${percent}%`;
    if (text && statusText) {
        text.textContent = statusText;
    } else if (text) {
        text.textContent = `正在生成... ${percent}%`;
    }
    if (percent >= 100) {
        setTimeout(() => {
            container.style.display = 'none';
            bar.style.width = '0%';
        }, 3000);
    }
}