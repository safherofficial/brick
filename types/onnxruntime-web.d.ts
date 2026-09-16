declare module "onnxruntime-web" {
  export class Tensor {
    constructor(type: string, data: Float32Array, dims: number[]);
    data: Float32Array;
  }

  export class InferenceSession {
    static create(
      path: string,
      options?: { executionProviders?: string[] }
    ): Promise<InferenceSession>;
    inputNames: string[];
    outputNames: string[];
    inputMetadata?: Record<string, { dims?: readonly number[] }>;
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  }

  export const env: {
    wasm: {
      wasmPaths: string;
    };
  };
}
