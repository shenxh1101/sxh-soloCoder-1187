export function initUI(callbacks) {
    const {
        onStart, onPause, onStop, onReset,
        onSpeedChange, onPresetSelect, onFileUpload, onExport,
        onTimelineChange, onTimelineRestore,
        onInspectEnter, onInspectExit, onInspectCut, onInspectView,
    } = callbacks;

    document.getElementById('btn-start').addEventListener('click', () => onStart());

    document.getElementById('btn-pause').addEventListener('click', () => {
        const btn = document.getElementById('btn-pause');
        if (btn.textContent.includes('继续')) {
            onStart();
        } else {
            onPause();
        }
    });

    document.getElementById('btn-stop').addEventListener('click', () => onStop());
    document.getElementById('btn-reset').addEventListener('click', () => onReset());

    document.getElementById('speed-slider').addEventListener('input', (e) => {
        onSpeedChange(parseFloat(e.target.value));
    });

    document.querySelectorAll('.preset-item').forEach(item => {
        item.addEventListener('click', () => onPresetSelect(item.dataset.preset));
    });

    const fileUpload = document.getElementById('file-upload');
    const fileInput = document.getElementById('file-input');
    fileUpload.addEventListener('click', () => fileInput.click());
    fileUpload.addEventListener('dragover', (e) => { e.preventDefault(); fileUpload.classList.add('dragover'); });
    fileUpload.addEventListener('dragleave', () => fileUpload.classList.remove('dragover'));
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

    document.getElementById('btn-export').addEventListener('click', () => onExport());

    const timelineSlider = document.getElementById('timeline-slider');
    timelineSlider.addEventListener('input', (e) => onTimelineChange(parseInt(e.target.value)));
    timelineSlider.addEventListener('change', (e) => onTimelineChange(parseInt(e.target.value)));

    document.getElementById('layer-height').addEventListener('change', () => onReset());
    document.getElementById('exposure-time').addEventListener('change', () => onReset());

    const btnInspect = document.getElementById('btn-inspect');
    if (btnInspect) {
        btnInspect.addEventListener('click', () => {
            if (btnInspect.textContent.includes('进入')) {
                onInspectEnter();
            } else {
                onInspectExit();
            }
        });
    }

    const inspectCutSlider = document.getElementById('inspect-cut');
    if (inspectCutSlider) {
        inspectCutSlider.addEventListener('input', (e) => onInspectCut(parseFloat(e.target.value)));
    }

    const inspectViewBtns = document.querySelectorAll('.inspect-view-btn');
    inspectViewBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            inspectViewBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            onInspectView(btn.dataset.view);
        });
    });
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
    text.textContent = customText || ({
        idle: '就绪',
        printing: '打印中...',
        paused: '已暂停',
        complete: '打印完成',
        error: '错误',
    }[status] || status);
}

export function updatePhaseStatus(phase) {
    const el = document.getElementById('phase-status');
    if (!el) return;
    el.textContent = ({
        lowering: '⬇ 平台下降中',
        exposure: '🔆 UV曝光中',
        lifting: '⬆ 平台抬升中',
        retraction: '↻ 回落等待中',
        raising: '⬆ 最终抬升中',
        paused: '⏸ 已暂停',
    }[phase] || '');
}

export function updateTimelineMax(max) {
    const slider = document.getElementById('timeline-slider');
    if (slider) slider.max = max;
}

export function updateTimelineValue(value) {
    const slider = document.getElementById('timeline-slider');
    if (slider) slider.value = value;
}

export function updateTimelineInfo(info) {
    const el = document.getElementById('timeline-detail');
    if (el) el.textContent = info;
}

export function updateButtonStates(state) {
    const btnStart = document.getElementById('btn-start');
    const btnPause = document.getElementById('btn-pause');
    const btnStop = document.getElementById('btn-stop');
    const btnReset = document.getElementById('btn-reset');
    const btnExport = document.getElementById('btn-export');
    const btnInspect = document.getElementById('btn-inspect');
    const speedSlider = document.getElementById('speed-slider');
    const timelineSection = document.getElementById('timeline-section');
    const timelineSlider = document.getElementById('timeline-slider');
    const inspectSection = document.getElementById('inspect-section');
    const exportSection = document.getElementById('export-section');

    const set = (btn, text, cls, disabled) => {
        if (!btn) return;
        btn.textContent = text;
        btn.className = `btn ${cls}`;
        btn.disabled = disabled;
    };

    const showEl = (el, show) => { if (el) el.style.display = show ? 'block' : 'none'; };

    switch (state) {
        case 'idle':
            set(btnStart, '▶ 开始打印', 'btn-primary', false);
            set(btnPause, '⏸ 暂停', 'btn-warn', true);
            set(btnStop, '⏹ 停止', 'btn', true);
            set(btnReset, '↺ 重置', 'btn', true);
            set(btnExport, '导出', 'btn-primary', true);
            if (btnInspect) set(btnInspect, '🔍 进入成品检查', 'btn', true);
            if (speedSlider) speedSlider.disabled = false;
            showEl(timelineSection, false);
            if (timelineSlider) timelineSlider.disabled = true;
            showEl(inspectSection, false);
            break;
        case 'ready':
            set(btnStart, '▶ 开始打印', 'btn-primary', false);
            set(btnPause, '⏸ 暂停', 'btn-warn', true);
            set(btnStop, '⏹ 停止', 'btn', true);
            set(btnReset, '↺ 重置', 'btn', false);
            set(btnExport, '导出', 'btn-primary', true);
            if (btnInspect) set(btnInspect, '🔍 进入成品检查', 'btn', true);
            if (speedSlider) speedSlider.disabled = false;
            showEl(timelineSection, false);
            if (timelineSlider) timelineSlider.disabled = true;
            showEl(inspectSection, false);
            break;
        case 'printing':
            set(btnStart, '▶ 开始打印', 'btn-primary', true);
            set(btnPause, '⏸ 暂停', 'btn-warn', false);
            set(btnStop, '⏹ 停止', 'btn', false);
            set(btnReset, '↺ 重置', 'btn', false);
            set(btnExport, '导出', 'btn-primary', true);
            if (btnInspect) set(btnInspect, '🔍 进入成品检查', 'btn', true);
            if (speedSlider) speedSlider.disabled = false;
            showEl(timelineSection, true);
            if (timelineSlider) timelineSlider.disabled = true;
            showEl(inspectSection, false);
            break;
        case 'paused':
            set(btnStart, '▶ 继续', 'btn-primary', false);
            set(btnPause, '⏸ 暂停', 'btn-warn', true);
            set(btnStop, '⏹ 停止', 'btn', false);
            set(btnReset, '↺ 重置', 'btn', false);
            set(btnExport, '导出', 'btn-primary', true);
            if (btnInspect) set(btnInspect, '🔍 进入成品检查', 'btn', true);
            if (speedSlider) speedSlider.disabled = false;
            showEl(timelineSection, true);
            if (timelineSlider) timelineSlider.disabled = false;
            showEl(inspectSection, false);
            break;
        case 'complete':
            set(btnStart, '▶ 开始打印', 'btn-primary', true);
            set(btnPause, '⏸ 暂停', 'btn-warn', true);
            set(btnStop, '⏹ 停止', 'btn', true);
            set(btnReset, '↺ 重置', 'btn', false);
            set(btnExport, '导出', 'btn-primary', false);
            if (btnInspect) set(btnInspect, '🔍 进入成品检查', 'btn', false);
            if (speedSlider) speedSlider.disabled = false;
            showEl(timelineSection, false);
            if (timelineSlider) timelineSlider.disabled = true;
            showEl(inspectSection, false);
            break;
        case 'inspect':
            set(btnStart, '▶ 开始打印', 'btn-primary', true);
            set(btnPause, '⏸ 暂停', 'btn-warn', true);
            set(btnStop, '⏹ 停止', 'btn', true);
            set(btnReset, '↺ 重置', 'btn', false);
            set(btnExport, '导出', 'btn-primary', false);
            if (btnInspect) set(btnInspect, '🔍 退出检查', 'btn-warn', false);
            if (speedSlider) speedSlider.disabled = true;
            showEl(timelineSection, false);
            if (timelineSlider) timelineSlider.disabled = true;
            showEl(inspectSection, true);
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
    bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    if (text) text.textContent = statusText || `正在生成... ${percent}%`;
    if (percent >= 100) {
        setTimeout(() => {
            container.style.display = 'none';
            bar.style.width = '0%';
        }, 4000);
    }
}