import type { DitherIconProps } from '@unlocalhosted/dither-icons';
import type { ComponentType } from 'react';

export type Glyph = ComponentType<Omit<DitherIconProps, 'name'>>;

/** A compact Dither icon: solid at control sizes, inherits currentColor, plays on its di-trigger parent. */
export const G = ({ icon: Component, size = 16, ...rest }: { icon: Glyph; size?: number } & Omit<DitherIconProps, 'name'>) => (
  <Component size={size} texture={'solid'} {...rest} style={{ display: 'block', flex: 'none', ...rest.style }} />
);
