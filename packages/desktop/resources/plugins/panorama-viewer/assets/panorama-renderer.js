function degreesToRadians(value) {
  return value * Math.PI / 180
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error("无法创建 WebGL shader")
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "WebGL shader 编译失败"
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function createProgram(gl) {
  const vertexSource = [
    "#version 300 es",
    "out vec2 vUv;",
    "void main() {",
    "  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));",
    "  vUv = position;",
    "  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);",
    "}",
  ].join("\n")
  const fragmentSource = [
    "#version 300 es",
    "precision highp float;",
    "in vec2 vUv;",
    "uniform sampler2D uPanorama;",
    "uniform vec2 uViewport;",
    "uniform float uYaw;",
    "uniform float uPitch;",
    "uniform float uFov;",
    "out vec4 outColor;",
    "const float PI = 3.141592653589793;",
    "void main() {",
    "  vec2 ndc = vUv * 2.0 - 1.0;",
    "  float aspect = uViewport.x / max(uViewport.y, 1.0);",
    "  float scale = tan(uFov * 0.5);",
    "  vec3 forward = vec3(sin(uYaw) * cos(uPitch), sin(uPitch), -cos(uYaw) * cos(uPitch));",
    "  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));",
    "  vec3 up = normalize(cross(right, forward));",
    "  vec3 ray = normalize(forward + right * ndc.x * aspect * scale + up * ndc.y * scale);",
    "  float longitude = atan(ray.x, -ray.z);",
    "  float latitude = asin(clamp(ray.y, -1.0, 1.0));",
    "  vec2 panoramaUv = vec2(fract(0.5 + longitude / (2.0 * PI)), 0.5 - latitude / PI);",
    "  vec3 color = texture(uPanorama, panoramaUv).rgb;",
    "  outColor = vec4(color, 1.0);",
    "}",
  ].join("\n")
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  if (!program) throw new Error("无法创建 WebGL program")
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "WebGL program 链接失败"
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

export function createPanoramaRenderer(canvas, viewer, scheduleRender) {
  const renderer = {
    contextState: "initializing",
    gl: null,
    imageHeight: 0,
    imageWidth: 0,
    program: null,
    ready: false,
    texture: null,
    uniforms: null,
  }

  renderer.initialize = function () {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      depth: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    })
    if (!gl) throw new Error("当前环境不支持 WebGL2")
    const program = createProgram(gl)
    renderer.gl = gl
    renderer.program = program
    renderer.uniforms = {
      fov: gl.getUniformLocation(program, "uFov"),
      panorama: gl.getUniformLocation(program, "uPanorama"),
      pitch: gl.getUniformLocation(program, "uPitch"),
      viewport: gl.getUniformLocation(program, "uViewport"),
      yaw: gl.getUniformLocation(program, "uYaw"),
    }
    gl.useProgram(program)
    gl.uniform1i(renderer.uniforms.panorama, 0)
    renderer.contextState = "ready"
    renderer.resize()
  }

  renderer.uploadTexture = function (image) {
    const gl = renderer.gl
    if (!gl || !renderer.program) throw new Error("WebGL2 尚未就绪")
    for (let count = 0; count < 8 && gl.getError() !== gl.NO_ERROR; count += 1) {
      // Drain stale WebGL errors so this upload owns the next error result.
    }
    const texture = gl.createTexture()
    if (!texture) throw new Error("无法创建全景纹理")
    try {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      gl.generateMipmap(gl.TEXTURE_2D)
      const uploadError = gl.getError()
      if (uploadError !== gl.NO_ERROR) throw new Error("GPU 纹理上传失败（WebGL " + String(uploadError) + "）")
      if (renderer.texture) gl.deleteTexture(renderer.texture)
      renderer.texture = texture
      renderer.ready = true
    } catch (error) {
      gl.deleteTexture(texture)
      throw error
    }
  }

  renderer.clearTexture = function () {
    if (renderer.gl && renderer.texture) renderer.gl.deleteTexture(renderer.texture)
    renderer.texture = null
    renderer.ready = false
  }

  renderer.resize = function () {
    const gl = renderer.gl
    if (!gl) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(viewer.clientWidth * ratio))
    const height = Math.max(1, Math.round(viewer.clientHeight * ratio))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    scheduleRender()
  }

  renderer.render = function (viewState) {
    const gl = renderer.gl
    if (!gl || !renderer.program) return
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0.04, 0.055, 0.08, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!renderer.texture || !renderer.ready) return
    gl.useProgram(renderer.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, renderer.texture)
    gl.uniform2f(renderer.uniforms.viewport, canvas.width, canvas.height)
    gl.uniform1f(renderer.uniforms.yaw, degreesToRadians(viewState.yawDeg))
    gl.uniform1f(renderer.uniforms.pitch, degreesToRadians(viewState.pitchDeg))
    gl.uniform1f(renderer.uniforms.fov, degreesToRadians(viewState.fovDeg))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  renderer.capture = function (viewState) {
    const gl = renderer.gl
    if (!gl || !renderer.program || !renderer.texture || !renderer.ready) {
      return Promise.reject(new Error("请先载入全景图后再截取画面"))
    }
    renderer.render(viewState)
    const width = canvas.width
    const height = canvas.height
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const readError = gl.getError()
    if (readError !== gl.NO_ERROR) {
      return Promise.reject(new Error("当前画面读取失败（WebGL " + String(readError) + "）"))
    }

    const output = document.createElement("canvas")
    output.width = width
    output.height = height
    const context = output.getContext("2d", { alpha: false })
    if (!context) return Promise.reject(new Error("无法创建截图画布"))
    const flipped = new Uint8ClampedArray(pixels.length)
    const rowBytes = width * 4
    for (let sourceRow = 0; sourceRow < height; sourceRow += 1) {
      const targetRow = height - sourceRow - 1
      flipped.set(pixels.subarray(sourceRow * rowBytes, (sourceRow + 1) * rowBytes), targetRow * rowBytes)
    }
    context.putImageData(new ImageData(flipped, width, height), 0, 0)
    return new Promise(function (resolve, reject) {
      output.toBlob(function (blob) {
        if (blob) resolve(blob)
        else reject(new Error("当前画面编码失败"))
      }, "image/png")
    })
  }

  renderer.dispose = function () {
    renderer.clearTexture()
    if (renderer.gl && renderer.program) renderer.gl.deleteProgram(renderer.program)
    renderer.program = null
    renderer.uniforms = null
  }

  return renderer
}
