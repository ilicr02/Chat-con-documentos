declare module 'unpdf' {
  export function getDocumentProxy(data: Uint8Array): Promise<any>
  export function extractText(pdf: any, options?: { mergePages?: boolean }): Promise<{ text: string | string[] }>
  // Añade aquí otras funciones que uses de unpdf
}
