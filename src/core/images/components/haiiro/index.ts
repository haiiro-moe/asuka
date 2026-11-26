/**
 * haiiro card primitives for satori: the building blocks every PNG card is made of.
 * Import from here, e.g. `import { CardFrame, KeyValue } from "./haiiro/index.ts"`.
 *
 * A card is `StillBackdrop` (root, full image) > `CardFrame` (window with notch label) >
 * rows of `Text`, `KeyValue`, `ProgressBar`, `Chip`, `RankMark`, `ImageFrame`, with one
 * `Title`. Colours come only from `tokens.ts` through `Tone` names.
 *
 * @packageDocumentation
 */
export * from "./tokens.ts";
export { Text, Rule, cleanText, toneColor, type Tone, type TextProps, type RuleProps } from "./text.tsx";
export { CardFrame, Notch, type CardFrameProps, type NotchProps, type FrameTone } from "./card-frame.tsx";
export {
  KeyValue,
  ProgressBar,
  Chip,
  Tag,
  RankMark,
  rankTone,
  type KeyValueProps,
  type ProgressBarProps,
  type ChipProps,
  type TagProps,
  type RankMarkProps,
} from "./stats.tsx";
export { ImageFrame, svgDataUri, type ImageFrameProps } from "./image-frame.tsx";
export { StillBackdrop, stillBackdropDataUri, type StillBackdropProps } from "./still-backdrop.tsx";
export { Title, titleFont, type TitleProps } from "./title.tsx";
