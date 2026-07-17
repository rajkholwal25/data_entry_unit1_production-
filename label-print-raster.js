/**
 * Rasterize on-screen label HTML (150mm × 100mm landscape) for WYSIWYG Zebra print.
 */
(function (global) {
    const LANDSCAPE_W_MM = 150;
    const LANDSCAPE_H_MM = 100;
    const PRINT_DPI = Number(global.LABEL_PRINT_DPI) || 300;

    async function inlineHostImages(host) {
        const imgs = host.querySelectorAll('img');
        for (const img of imgs) {
            const src = (img.getAttribute('src') || '').trim();
            if (!src || src.startsWith('data:')) continue;
            try {
                const res = await fetch(src, { cache: 'no-store' });
                const blob = await res.blob();
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result || ''));
                    reader.onerror = () => reject(new Error('Failed to read image'));
                    reader.readAsDataURL(blob);
                });
                img.setAttribute('src', dataUrl);
            } catch {
                img.style.display = 'none';
            }
        }
    }

    /**
     * @param {string} labelHtml — full label-page HTML from ProcessLabelFormats / FG generator
     * @returns {Promise<string>} raw base64 PNG (no data: prefix)
     */
    async function rasterizeLabelHtmlToPngBase64(labelHtml) {
        if (typeof html2canvas !== 'function') {
            throw new Error('html2canvas is not loaded — cannot rasterize label preview');
        }
        if (!labelHtml || !String(labelHtml).trim()) {
            throw new Error('No label HTML to print');
        }

        const host = document.createElement('div');
        host.style.cssText = [
            'position:fixed',
            'left:-10000px',
            'top:0',
            `width:${LANDSCAPE_W_MM}mm`,
            `height:${LANDSCAPE_H_MM}mm`,
            'background:#fff',
            'overflow:hidden'
        ].join(';');
        host.innerHTML = labelHtml;

        const page = host.querySelector('.label-page');
        if (page) {
            page.style.transform = 'none';
            page.style.position = 'static';
            page.style.boxShadow = 'none';
            page.style.margin = '0';
        }
        const inner = host.querySelector('.label-page-inner');
        if (inner) inner.style.transform = 'none';

        document.body.appendChild(host);
        try {
            await inlineHostImages(host);
            const cssPxPerMm = 96 / 25.4;
            const scale = (PRINT_DPI / 25.4) / cssPxPerMm;
            const canvas = await html2canvas(host, {
                backgroundColor: '#ffffff',
                scale,
                useCORS: true,
                logging: false
            });
            return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
        } finally {
            host.remove();
        }
    }

    global.LabelPrintRaster = { rasterizeLabelHtmlToPngBase64 };
})(typeof window !== 'undefined' ? window : globalThis);
