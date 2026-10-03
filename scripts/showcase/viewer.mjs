import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

const params = new URLSearchParams(location.search)
if (params.has('capture')) document.body.classList.add('capture')
const scene = new T.Scene()
scene.background = new T.Color('#141c26')
const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(2, devicePixelRatio))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = T.SRGBColorSpace
renderer.toneMapping = T.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.9
renderer.shadowMap.enabled = true
renderer.shadowMap.type = T.PCFSoftShadowMap
document.body.append(renderer.domElement)
const camera = new T.OrthographicCamera(-500, 500, 500, -500, 1, 4000)
camera.up.set(0, 0, 1)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.1
const environment = new RoomEnvironment()
environment.rotation.x = Math.PI / 2
const pmrem = new T.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(environment, 0.04).texture
scene.environmentIntensity = 0.55
const key = new T.DirectionalLight('#f3f6ff', 3.3)
key.position.set(100, -450, 900)
key.castShadow = true
key.shadow.mapSize.set(4096, 4096)
key.shadow.camera.left = -650
key.shadow.camera.right = 650
key.shadow.camera.top = 650
key.shadow.camera.bottom = -650
key.shadow.camera.near = 1
key.shadow.camera.far = 1700
key.shadow.normalBias = 0.35
key.shadow.bias = -0.00007
key.shadow.radius = 3
scene.add(key)
const fill = new T.DirectionalLight('#77b7d6', 1.4)
fill.position.set(-500, -300, 500)
scene.add(fill)
const rim = new T.DirectionalLight('#bcd1fa', 2.6)
rim.position.set(450, 500, 700)
scene.add(rim)
scene.add(new T.AmbientLight('#c7d9e9', 0.18))
const floor = new T.Mesh(
  new T.PlaneGeometry(4000, 4000),
  new T.MeshStandardMaterial({ color: '#080d14', roughness: 0.95, metalness: 0 }),
)
floor.position.z = -0.3
floor.receiveShadow = true
scene.add(floor)
const model = new T.Group()
scene.add(model)
const data = window.__PRINTER_SCENE__ || (await (await fetch('/printer-scene.json')).json())
const geometries = new Map(),
  materials = new Map()
for (const [id, g] of Object.entries(data.geometries)) {
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(g.positions, 3))
  geometry.setAttribute('normal', new T.Float32BufferAttribute(g.normals, 3))
  geometry.setIndex(g.triangles)
  geometry.computeBoundingSphere()
  geometries.set(id, geometry)
}
const metallic = new Set(['silver', 'steel', 'rail', 'brass', 'copper'])
for (const i of data.instances) {
  if (!materials.has(i.material))
    materials.set(
      i.material,
      new T.MeshStandardMaterial({
        color: i.colour,
        metalness: metallic.has(i.material) ? 0.82 : i.material === 'frame' ? 0.58 : 0,
        roughness:
          i.material === 'steel'
            ? 0.25
            : i.material === 'silver'
              ? 0.34
              : i.material === 'rail'
                ? 0.3
                : i.material === 'frame'
                  ? 0.47
                  : i.material === 'rubber'
                    ? 0.86
                    : 0.55,
        ...(i.material === 'screen' ? { emissive: '#2c6279', emissiveIntensity: 0.3 } : {}),
      }),
    )
  const mesh = new T.Mesh(geometries.get(i.geometry), materials.get(i.material))
  mesh.name = i.name
  mesh.userData = { group: i.group, id: i.id }
  mesh.matrix.fromArray(i.matrix)
  mesh.matrixAutoUpdate = false
  mesh.castShadow = i.name !== 'Filament winding groove'
  mesh.receiveShadow = i.name !== 'Filament winding groove'
  model.add(mesh)
}
// Text lives on the LCD surface. Geometry and mechanics come from the CAD assembly.
const lcd = document.createElement('canvas')
lcd.width = 768
lcd.height = 256
const ctx = lcd.getContext('2d')
ctx.fillStyle = '#103541'
ctx.fillRect(0, 0, 768, 256)
ctx.fillStyle = '#b7e4e3'
ctx.font = 'bold 55px monospace'
ctx.fillText('OpenKitCAD', 35, 72)
ctx.font = '34px monospace'
ctx.fillText('NOZZLE  210°    BED  60°', 35, 132)
ctx.fillStyle = '#63c1c5'
ctx.fillRect(35, 165, 490, 17)
ctx.fillStyle = '#204d5c'
ctx.fillRect(525, 165, 195, 17)
ctx.fillStyle = '#a6d8da'
ctx.font = '29px monospace'
ctx.fillText('Ready to print', 35, 226)
const display = data.instances.find((i) => i.name === 'LCD glass')
if (display) {
  const tex = new T.CanvasTexture(lcd)
  tex.colorSpace = T.SRGBColorSpace
  const panel = new T.Mesh(
    new T.PlaneGeometry(78, 27),
    new T.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: '#ffffff',
      emissiveIntensity: 0.6,
      roughness: 0.4,
    }),
  )
  panel.matrix.fromArray(display.matrix)
  panel.matrix.multiply(new T.Matrix4().makeTranslation(0, 0, 0.42))
  panel.matrixAutoUpdate = false
  model.add(panel)
}
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const ao = new GTAOPass(scene, camera, innerWidth, innerHeight)
ao.updateGtaoMaterial({ radius: 16, distanceExponent: 1, thickness: 1.5, scale: 1 })
composer.addPass(ao)
composer.addPass(new OutputPass())
function fit(target, position, height) {
  controls.target.set(...target)
  camera.position.set(...position)
  const aspect = innerWidth / innerHeight
  camera.left = (-height * aspect) / 2
  camera.right = (height * aspect) / 2
  camera.top = height / 2
  camera.bottom = -height / 2
  camera.updateProjectionMatrix()
  controls.update()
}
function view(name) {
  if (name === 'back') fit([0, 20, 285], [-800, 1000, 850], 800)
  else if (name === 'head') fit([22, -55, 217], [265, -510, 360], 195)
  else if (name === 'bed') fit([0, -10, 65], [360, -650, 330], 420)
  else fit([0, 0, 305], [820, -1130, 900], 800)
}
for (const name of ['home', 'back', 'head', 'bed'])
  document.getElementById(name).onclick = () => view(name)
view(params.get('view') || 'home')
window.printer = {
  scene,
  model,
  camera,
  controls,
  renderer,
  composer,
  data,
  view,
  fit,
  exportGlb: async () => {
    const glb = await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: true })
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    const loaded = await new GLTFLoader().parseAsync(glb, '')
    let count = 0
    loaded.scene.traverse((o) => {
      if (o.isMesh) count++
    })
    if (count !== model.children.filter((o) => o.isMesh).length)
      throw new Error('GLB round-trip changed the mesh count')
    const before = new T.Box3().setFromObject(model)
    const after = new T.Box3().setFromObject(loaded.scene)
    if (before.min.distanceTo(after.min) > 0.05 || before.max.distanceTo(after.max) > 0.05)
      throw new Error('GLB round-trip changed the assembly bounds')
    let str = ''
    const bytes = new Uint8Array(glb)
    for (let i = 0; i < bytes.length; i += 32768)
      str += String.fromCharCode(...bytes.subarray(i, i + 32768))
    return btoa(str)
  },
}
let frames = 0
function animate() {
  requestAnimationFrame(animate)
  controls.update()
  composer.render()
  if (++frames === 8) window.printerReady = true
}
if (params.has('trace') && (typeof __SHOWCASE_TRACING__ === 'undefined' || __SHOWCASE_TRACING__)) {
  const { WebGLPathTracer, GradientEquirectTexture, DenoiseMaterial } =
    await import('three-gpu-pathtracer')
  scene.children.filter((o) => o.isLight).forEach((o) => scene.remove(o))
  const env = new GradientEquirectTexture(512)
  env.topColor.set('#b8cee0')
  env.bottomColor.set('#263340')
  env.update()
  scene.environment = env
  scene.environmentIntensity = 0.5
  for (const [colour, intensity, width, height, position] of [
    ['#eff5ff', 6, 650, 650, [100, -350, 900]],
    ['#80c1e1', 2.5, 600, 650, [-650, -250, 500]],
    ['#fff1d9', 5, 450, 700, [500, 450, 650]],
  ]) {
    const light = new T.RectAreaLight(colour, intensity, width, height)
    light.position.set(...position)
    light.lookAt(0, 0, 280)
    scene.add(light)
  }
  const tracer = new WebGLPathTracer(renderer)
  tracer.bounces = 5
  tracer.renderDelay = 0
  tracer.fadeDuration = 0
  tracer.setScene(scene, camera)
  const denoiser = new DenoiseMaterial({
    map: tracer.target.texture,
    sigma: 2,
    kSigma: 1,
    threshold: 0.07,
  })
  const quad = new FullScreenQuad(denoiser)
  tracer.renderToCanvasCallback = () => quad.render(renderer)
  window.printer.tracer = tracer
  controls.addEventListener('change', () => {
    tracer.updateCamera()
    tracer.reset()
  })
  function trace() {
    requestAnimationFrame(trace)
    controls.update()
    tracer.renderSample()
    if (tracer.samples >= 4) window.printerReady = true
  }
  trace()
} else animate()
window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight)
  composer.setSize(innerWidth, innerHeight)
  view('home')
})
