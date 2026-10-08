import { darkAlgorithm } from '@lobehub/ui/es/styles/theme/algorithms/darkAlgorithm';
import { lightAlgorithm } from '@lobehub/ui/es/styles/theme/algorithms/lightAlgorithm';

// Arvak purple palette (the blog's current design language).
// lobe-ui's algorithm rewrites every color token, so ours runs after it.
const mix = (color: string, alpha: number) => `color-mix(in srgb, ${color} ${alpha}%, transparent)`;

function tokens(dark: boolean) {
  // Tokens from ~/Devs/arvak-blog-purple/app/globals.css; semantic green/red/amber tuned to sit with the purple.
  const base = dark
    ? {
        primary: '#bea5f5', success: '#7cc49a', error: '#f08a8a', warning: '#e3b565',
        layout: '#131118', container: '#17141e', elevated: '#1e1b25',
        text: '#eeebf5', text2: '#aba5b9', text3: '#8d879f', text4: '#6c667d',
        border: '#3a3448', border2: '#2f2a3a', fill4: '#1c1826', fill3: '#1e1b25', fill2: '#2a2535', fill: '#332d40',
      }
    : {
        primary: '#7048b4', success: '#2f8a5b', error: '#c2413b', warning: '#a86a12',
        layout: '#ffffff', container: '#ffffff', elevated: '#ffffff',
        text: '#1d1b22', text2: '#5b5866', text3: '#77728a', text4: '#a19cb0',
        border: '#ddd6ea', border2: '#e7e2f1', fill4: '#f7f3fe', fill3: '#f5f3f9', fill2: '#ece7f5', fill: '#e4ddf0',
      };
  const tone = (name: 'Primary' | 'Success' | 'Error' | 'Warning', color: string) => ({
    [`color${name}`]: color,
    [`color${name}Hover`]: mix(color, 85),
    [`color${name}Active`]: color,
    [`color${name}Text`]: color,
    [`color${name}TextHover`]: mix(color, 85),
    [`color${name}TextActive`]: color,
    [`color${name}Bg`]: mix(color, dark ? 14 : 10),
    [`color${name}BgHover`]: mix(color, dark ? 20 : 15),
    [`color${name}Border`]: mix(color, 35),
    [`color${name}BorderHover`]: mix(color, 50),
  });
  return {
    ...tone('Primary', base.primary),
    ...tone('Success', base.success),
    ...tone('Error', base.error),
    ...tone('Warning', base.warning),
    colorInfo: base.primary,
    colorLink: base.primary,
    colorLinkHover: mix(base.primary, 85),
    colorBgLayout: base.layout,
    colorBgContainer: base.container,
    colorBgElevated: base.elevated,
    colorBgBase: base.layout,
    colorText: base.text,
    colorTextBase: base.text,
    colorTextSecondary: base.text2,
    colorTextTertiary: base.text3,
    colorTextQuaternary: base.text4,
    colorTextDescription: base.text3,
    colorBorder: base.border,
    colorBorderSecondary: base.border2,
    colorSplit: base.border2,
    colorFill: base.fill,
    colorFillSecondary: base.fill2,
    colorFillTertiary: base.fill3,
    colorFillQuaternary: base.fill4,
    colorFillContent: base.fill3,
    colorFillAlter: base.fill4,
    colorBgTextHover: base.fill3,
  };
}

type Algorithm = (seed: any, map?: any) => any;

export const algorithm = (dark: boolean): Algorithm[] => [
  (dark ? darkAlgorithm : lightAlgorithm) as Algorithm,
  (_seed, map) => ({ ...map, ...tokens(dark) }),
];
