# Style

A style is a reference kind that keeps reference images, and a shot names a version of it as the input `<id>@<version>`, such as `s1@1`. Create styles during project setup, after `dv_asset_import` of the user's reference images and before any render.

## Create

- `dv_style_create` only when the user named a look (film grain, palette, lens): `style` (such as `s1`), `name`, `description`.

## Update

When the user asks for a look later, such as "change the style" or "add film grain", call `dv_style_create` (or `dv_style_update`), then propose retakes that add `s1@1` to `inputs.reference`; retakes need the user's agreement, asked in bold.
