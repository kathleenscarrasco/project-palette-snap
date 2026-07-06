export async function imageUrlToBase64(imageUrl: string, mimeType?: string) {
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  const dataUrl = await blobToDataUrl(blob);
  const comma = dataUrl.indexOf(",");
  return {
    data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
    type: blob.type || mimeType || "image/jpeg",
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
