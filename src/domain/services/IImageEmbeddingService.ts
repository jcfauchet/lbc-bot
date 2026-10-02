/** Turns an image into a vector comparable by cosine similarity with other images. */
export interface IImageEmbeddingService {
  embedImage(imageUrl: string): Promise<number[]>
}
