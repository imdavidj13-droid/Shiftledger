# ShiftLedger visual system — mandatory rules

## Absolute visual constraints
- Use **100% opaque** surfaces. No rgba(), hsla(), opacity, translucent layers or glassmorphism.
- No shadows of any kind: no box-shadow, text-shadow, filter drop-shadow or blurred overlays.
- No gradients. Solid colour fills only.
- Use saturated, high-contrast colour areas, clearly delineated sections and borders.
- Disabled controls retain full opacity. Their states must be communicated through solid colours and text.
- Focus-visible uses a solid high-contrast outline, not a glow.
- Modal backdrops, if introduced, must be solid and never use transparency.
- Do not implement a dimming/scrim effect with opacity.

## Tokens
| Purpose | Hex |
| --- | --- |
| Primary forest | #075641 |
| Active green | #0B8062 |
| Bright lime | #C9F05E |
| Dark ink | #10261F |
| Canvas | #F4F8EC |
| Surface | #FFFFFF |
| Surface tinted | #E4F2D9 |
| Edge | #BCD1C3 |
| Warning | #FFE1A8 |
| Error | #B52C2C |

## Components
Solid sidebar, high-contrast navigation, bold headings, cards with visible borders, solid primary and secondary buttons, form labels above controls, intentional empty states, accessible keyboard focus.

## Policy
These choices are project-level defaults for every new screen and component. Only change them when explicitly requested by the owner.
