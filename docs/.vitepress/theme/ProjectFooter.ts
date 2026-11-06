import {defineComponent, h} from 'vue';
import './ProjectFooter.css';

export default defineComponent({
    name: 'ProjectFooter',
    setup() {
        return () => h('footer', {class: 'project-footer', 'aria-label': 'Project credits'}, [
            h('p', [
                h('span', [
                    'Built and maintained by ',
                    h('a', {href: 'https://jalsoedesign.net'}, 'jalsoedesign.net'),
                ]),
                ' ',
                h('span', {class: 'license'}, [
                    h('span', {'aria-hidden': 'true'}, '\u00b7'),
                    ' ',
                    h('a', {href: 'https://github.com/h2ooooooo/dockline/blob/main/LICENSE'}, 'MIT licensed'),
                ]),
            ]),
        ]);
    },
});
