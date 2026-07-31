// replicad-opencascadejs ships an emscripten glue file with no type
// declarations. We only ever call the default export (the module factory) and
// hand the result straight to replicad's setOC, so `any` is honest here.
declare module 'replicad-opencascadejs/src/replicad_single.js' {
  interface OpenCascadeInstance {
    [key: string]: any
  }
  interface ModuleOptions {
    locateFile?: (path: string, prefix: string) => string
    [key: string]: unknown
  }
  const initOpenCascade: (options?: ModuleOptions) => Promise<OpenCascadeInstance>
  export default initOpenCascade
}

declare module 'replicad-opencascadejs/src/replicad_single.wasm?url' {
  const url: string
  export default url
}
