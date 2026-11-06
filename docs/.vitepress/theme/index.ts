import DefaultTheme from 'vitepress/theme';
import {h} from 'vue';
import ProjectFooter from './ProjectFooter.js';
import {inBrowser, onContentUpdated} from 'vitepress';
import './style.scss';

const languages = new Set(['TypeScript', 'JavaScript', 'MJS', 'CommonJS']);
let selectedLanguage = 'TypeScript';

function synchronizeExamples() {
    if (!inBrowser) {
        return;
    }

    for (const group of document.querySelectorAll('.vp-code-group')) {
        const inputs = Array.from(group.querySelectorAll<HTMLInputElement>('.tabs input'));
        const selected = inputs.findIndex(input => {
            const label = group.querySelector('label[for="' + CSS.escape(input.id) + '"]');

            return label?.textContent?.trim() === selectedLanguage;
        });

        if (selected < 0) {
            continue;
        }

        inputs.forEach((input, index) => {
            input.checked = index === selected;
        });
        Array.from(group.querySelector('.blocks')?.children ?? []).forEach((block, index) => {
            block.classList.toggle('active', index === selected);
        });
    }
}

export default {
    extends: DefaultTheme,
    Layout() {
        return h(DefaultTheme.Layout, null, {
            'layout-bottom': () => h(ProjectFooter),
        });
    },
    setup() {
        onContentUpdated(synchronizeExamples);
    },
    enhanceApp() {
        if (!inBrowser) {
            return;
        }

        window.addEventListener('click', event => {
            const input = event.target;

            if (!(input instanceof HTMLInputElement) || !input.matches('.vp-code-group .tabs input')) {
                return;
            }

            const group = input.closest('.vp-code-group');
            const label = group?.querySelector('label[for="' + CSS.escape(input.id) + '"]');
            const language = label?.textContent?.trim();

            if (language && languages.has(language)) {
                selectedLanguage = language;
                synchronizeExamples();
            }
        });
    },
};
