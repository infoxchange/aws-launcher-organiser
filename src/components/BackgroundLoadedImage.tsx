import { useEffect, useState } from "react";

/**
 * Request image as data URL from background service worker to avoid CORS issues
 */
async function fetchImageAsDataUrl(src: string): Promise<string> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "FETCH_IMAGE",
      src,
    });

    if (!response.success) {
      console.error(`Failed to fetch image from ${src}:`, response.error);
      return src;
    }

    // Return data URL directly (CSP allows data: URLs)
    return response.dataUrl;
  } catch (error) {
    console.error(`Failed to fetch image from ${src}:`, error);
    return src;
  }
}

/**
 * React component that displays an image by fetching it as a data URL
 */
export function BackgroundLoadedImage({
  src,
  iconProps,
  forwardedRef,
  placeholder,
}: {
  src: string;
  iconProps: React.ImgHTMLAttributes<HTMLImageElement>;
  forwardedRef: React.Ref<HTMLImageElement>;
  placeholder?: string;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    fetchImageAsDataUrl(src).then((url) => {
      if (isMounted) {
        setImageUrl(url);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [src]);

  if (!imageUrl) {
    return placeholder;
  }

  return <img src={imageUrl} {...iconProps} ref={forwardedRef} alt="" aria-hidden="true" />;
}
