// Enhanced interactivity for the Unit 1 (Holographic) Dashboard

document.addEventListener('DOMContentLoaded', function() {
    const machinesView = document.getElementById('home-view');
    const traceView = document.getElementById('traceability-view');
    const labelsView = document.getElementById('process-labels-view');
    const dimsView = document.getElementById('batch-dimensions-view');
    const grnView = document.getElementById('grn-roll-labels-view');
    const btnOpenTrace = document.getElementById('btn-open-trace');
    const btnOpenLabels = document.getElementById('btn-open-labels');
    const btnOpenDims = document.getElementById('btn-open-dims');
    const btnOpenGrn = document.getElementById('btn-open-grn');
    const btnBackMachines = document.getElementById('btn-back-machines');
    const btnBackFromLabels = document.getElementById('btn-back-from-labels');
    const btnBackFromDims = document.getElementById('btn-back-from-dims');
    const btnBackFromGrn = document.getElementById('btn-back-from-grn');
    const pageTitle = document.getElementById('page-main-title');
    const pageSubtitle = document.getElementById('page-subtitle');
    const headerActions = document.querySelector('.header-top-actions');

    function setHeaderButtonsVisible(visible) {
        if (headerActions) headerActions.style.display = visible ? '' : 'none';
    }

    function hideAllPanels() {
        if (traceView) traceView.classList.add('hidden');
        if (labelsView) labelsView.classList.add('hidden');
        if (dimsView) dimsView.classList.add('hidden');
        if (grnView) grnView.classList.add('hidden');
        if (machinesView) machinesView.classList.add('hidden');
    }

    function showMachinesView() {
        hideAllPanels();
        if (machinesView) machinesView.classList.remove('hidden');
        setHeaderButtonsVisible(true);
        if (pageTitle) pageTitle.textContent = 'Unit 1 - Holographic';
        if (pageSubtitle) pageSubtitle.textContent = 'Select a holographic process and machine to enter production data';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showTraceView() {
        hideAllPanels();
        if (traceView) traceView.classList.remove('hidden');
        setHeaderButtonsVisible(false);
        if (pageTitle) pageTitle.textContent = 'Material Traceability';
        if (pageSubtitle) pageSubtitle.textContent = 'Search by production order or batch number to trace inputs and outputs';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (typeof window.traceabilityRunFromParams === 'function') {
            window.traceabilityRunFromParams();
        }
    }

    function showLabelsView() {
        hideAllPanels();
        if (labelsView) labelsView.classList.remove('hidden');
        setHeaderButtonsVisible(false);
        if (pageTitle) pageTitle.textContent = 'Process Labels';
        if (pageSubtitle) pageSubtitle.textContent = 'Load a production order — select each output batch to preview and print its label';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (typeof window.processLabelsRunFromParams === 'function') {
            window.processLabelsRunFromParams();
        }
    }

    function showBatchDimensionsView() {
        hideAllPanels();
        if (dimsView) dimsView.classList.remove('hidden');
        setHeaderButtonsVisible(false);
        if (pageTitle) pageTitle.textContent = 'Update Batch Data';
        if (pageSubtitle) pageSubtitle.textContent = 'Search production order — set width and length on saved output batches';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (typeof window.batchDimensionsRunFromParams === 'function') {
            window.batchDimensionsRunFromParams();
        }
    }

    function showGrnRollLabelsView() {
        hideAllPanels();
        if (grnView) grnView.classList.remove('hidden');
        setHeaderButtonsVisible(false);
        if (pageTitle) pageTitle.textContent = 'GRN Roll Labels';
        if (pageSubtitle) pageSubtitle.textContent = 'Sync FBD-RM stock, search batch, preview and print roll labels';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (typeof window.grnRollLabelsOnShow === 'function') {
            window.grnRollLabelsOnShow();
        }
    }

    if (btnOpenTrace) btnOpenTrace.addEventListener('click', showTraceView);
    if (btnOpenLabels) btnOpenLabels.addEventListener('click', showLabelsView);
    if (btnOpenDims) btnOpenDims.addEventListener('click', showBatchDimensionsView);
    if (btnOpenGrn) btnOpenGrn.addEventListener('click', showGrnRollLabelsView);
    if (btnBackMachines) btnBackMachines.addEventListener('click', showMachinesView);
    if (btnBackFromLabels) btnBackFromLabels.addEventListener('click', showMachinesView);
    if (btnBackFromDims) btnBackFromDims.addEventListener('click', showMachinesView);
    if (btnBackFromGrn) btnBackFromGrn.addEventListener('click', showMachinesView);

    window.showHomeMachinesView = showMachinesView;
    window.showProcessLabelsView = showLabelsView;
    window.showBatchDimensionsView = showBatchDimensionsView;
    window.showGrnRollLabelsView = showGrnRollLabelsView;

    const params = new URLSearchParams(location.search);
    if (params.get('view') === 'grn') {
        showGrnRollLabelsView();
    } else if (params.get('view') === 'dims' || params.get('dimsPo')) {
        showBatchDimensionsView();
    } else if (params.get('view') === 'labels' || params.get('label') || params.get('labelPo')) {
        showLabelsView();
    } else if (params.get('view') === 'trace' || params.get('po') || params.get('batch')) {
        showTraceView();
    }

    // Add ripple effect to machine items
    const machineItems = document.querySelectorAll('.machine-item');

    machineItems.forEach(item => {
        item.addEventListener('click', function(e) {
            const ripple = document.createElement('span');
            ripple.classList.add('ripple');
            this.appendChild(ripple);

            const rect = this.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = e.clientX - rect.left - size / 2;
            const y = e.clientY - rect.top - size / 2;

            ripple.style.width = ripple.style.height = size + 'px';
            ripple.style.left = x + 'px';
            ripple.style.top = y + 'px';

            setTimeout(() => ripple.remove(), 600);
        });
    });

    // Add hover effect enhancement
    const processCards = document.querySelectorAll('.process-card');

    processCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        });
    });

    // Keyboard navigation
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
            document.body.classList.add('keyboard-nav');
        }
    });

    document.addEventListener('mousedown', function() {
        document.body.classList.remove('keyboard-nav');
    });

    // Add loading animation for page transitions
    machineItems.forEach(item => {
        item.addEventListener('click', function(e) {
            if (!e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                const href = this.getAttribute('href');

                document.body.style.opacity = '0';
                document.body.style.transition = 'opacity 0.3s ease';

                setTimeout(() => {
                    window.location.href = href;
                }, 300);
            }
        });
    });

    console.log('Unit 1 Holographic Dashboard initialized');
});
