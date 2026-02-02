# NSFW Image Detection Setup

This document describes how to set up local NSFW (Not Safe For Work) image detection for the chat app.

## Current Implementation

The app includes a placeholder NSFW detection system that is ready for integration with an actual ML model. Currently, it always returns "safe" but logs a warning.

## Integration Options

### Option 1: NSFWJS (Recommended for Browser/Node.js)

NSFWJS is a TensorFlow.js model that can run locally:

```bash
npm install nsfwjs
```

Then update `src/lib/nsfw-detector.ts`:

```typescript
import * as nsfwjs from 'nsfwjs';

let model: nsfwjs.NSFWJS | null = null;

export async function detectNSFW(imageUrl: string): Promise<NSFWDetectionResult> {
  try {
    // Load model on first call (cache it)
    if (!model) {
      model = await nsfwjs.load();
    }
    
    // Load and classify image
    const img = await nsfwjs.loadImage(imageUrl);
    const predictions = await model.classify(img);
    
    // Check for unsafe content
    const pornScore = predictions.find(p => p.className === 'Porn')?.probability || 0;
    const hentaiScore = predictions.find(p => p.className === 'Hentai')?.probability || 0;
    const sexyScore = predictions.find(p => p.className === 'Sexy')?.probability || 0;
    
    // Threshold: flag if porn/hentai > 0.5, or sexy > 0.7
    const isUnsafe = pornScore > 0.5 || hentaiScore > 0.5 || sexyScore > 0.7;
    const maxScore = Math.max(pornScore, hentaiScore, sexyScore);
    
    return {
      isUnsafe,
      confidence: maxScore,
      category: pornScore > hentaiScore ? 'porn' : hentaiScore > sexyScore ? 'hentai' : 'sexy',
      reason: isUnsafe 
        ? `Detected ${pornScore > hentaiScore ? 'pornographic' : hentaiScore > sexyScore ? 'hentai' : 'inappropriate'} content (confidence: ${maxScore.toFixed(2)})`
        : undefined,
    };
  } catch (error) {
    console.error("[NSFW Detector] Error during detection:", error);
    return {
      isUnsafe: false,
      confidence: 0,
      category: "error",
      reason: "Detection failed - manual review recommended",
    };
  }
}
```

### Option 2: Hugging Face Transformers (Python Backend)

If you prefer a Python backend:

1. Create a Python service that uses Hugging Face models
2. Call it from the Next.js API route
3. Example: Use `transformers` library with `google/vit-base-patch16-224` fine-tuned for NSFW

### Option 3: Custom TensorFlow Model

Train or use a custom TensorFlow model and serve it via TensorFlow Serving or convert to TensorFlow.js.

## How It Works

1. **Image Upload**: When a child uploads an image, it's stored in Supabase Storage
2. **Automatic Scanning**: After upload, `/api/moderation/scan-image` is called (non-blocking)
3. **Detection**: The image is analyzed for NSFW content
4. **Flagging**: If unsafe content is detected:
   - A flag is inserted into the `flags` table
   - The recipient child's parent is notified via "Sikker Chat" system user
   - The image is marked with an amber ring in the UI
5. **Parent Review**: Parents can review and clear flags if they determine the image is safe

## Testing

To test the system:

1. Upload an image as a child user
2. Check the browser console for scanning logs
3. If flagged, check the `flags` table in Supabase
4. Verify parent receives notification in their chat list

## Performance Considerations

- Scanning is asynchronous and non-blocking
- Model loading is cached (loads once, reuses)
- Consider rate limiting if needed
- For production, consider:
  - Image resizing before scanning (faster)
  - Queue system for high volume
  - Caching results for duplicate images

## Security Notes

- All detection runs locally (no external APIs)
- Images are not stored permanently for scanning (only in Supabase Storage)
- Flags are stored securely with RLS policies
- Parents can override system flags if needed
