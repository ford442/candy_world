# Custom Splash Image Configuration

The loading screen now supports custom splash background images!

## How to Add a Custom Splash Image

### Method 1: Using CSS Variable (Recommended)

Add this to your HTML or CSS:

```css
#loading-overlay {
    --splash-image: url('path/to/your/image.png');
}
```

### Method 2: Using Inline Style

Modify the `#loading-overlay` div in `index.html`:

```html
<div id="loading-overlay" style="--splash-image: url('assets/splash.png');">
```

## Image Recommendations

- **Format**: PNG, JPG, or WebP
- **Resolution**: 1920x1080 or higher for best quality
- **Aspect Ratio**: 16:9 works well for most screens
- **Style**: The loading spinner and text will be overlaid on your image with a white backdrop for visibility

## Example

```css
/* Candy-themed gradient splash */
#loading-overlay {
    --splash-image: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

/* Or use an actual image */
#loading-overlay {
    --splash-image: url('assets/candy-world-splash.jpg');
}
```

The image will be displayed with `background-size: cover` and `background-position: center`, ensuring it always fills the screen regardless of resolution.
