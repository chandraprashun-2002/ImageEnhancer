import { useEffect, useRef, useState } from 'react'

const DEMO_BEFORE = '/demo/before.jpg'
const DEMO_AFTER = '/demo/after.jpg'

/** Short-side resolution tiers (must match backend RESOLUTION_TIERS). */
const RESOLUTION_TIERS = [240, 360, 480, 720, 1080, 1440, 2160]
const MAX_OUTSCALE = 4

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function cn(...parts) {
  return parts.filter(Boolean).join(' ')
}

function tierForShortSide(short) {
  let current = 0
  for (const tier of RESOLUTION_TIERS) {
    if (short >= tier) current = tier
    else break
  }
  return current
}

function tierLabel(tier) {
  return tier ? `${tier}p` : 'below 240p'
}

function firstReachableTarget(short, currentTier) {
  return (
    RESOLUTION_TIERS.find((tier) => {
      if (tier <= currentTier) return false
      const scale = tier / short
      return scale > 1 && scale <= MAX_OUTSCALE + 1e-6
    }) ?? null
  )
}

const primaryBtn =
  'w-full rounded-full border-0 bg-gradient-to-br from-accent to-[#c4894f] px-5 py-3 font-semibold text-[#1a120c] transition hover:-translate-y-px hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto'

const ghostBtn =
  'inline-flex w-full items-center justify-center rounded-full border border-ink/12 bg-transparent px-5 py-3 text-ink no-underline transition hover:border-ink/28 hover:bg-ink/[0.04] sm:w-auto'

const textLink =
  'w-fit border-0 bg-transparent p-0 text-[0.9rem] text-muted underline underline-offset-[0.15em] transition hover:text-ink'

export default function App() {
  const [mode, setMode] = useState('demo')
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [imageMeta, setImageMeta] = useState(null)
  const [targetP, setTargetP] = useState(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [health, setHealth] = useState(null)
  const [result, setResult] = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const [slider, setSlider] = useState(50)
  const [reveal, setReveal] = useState(false)
  const [openPicker, setOpenPicker] = useState(false)
  const [resolutionOpen, setResolutionOpen] = useState(false)
  const frameRef = useRef(null)
  const fileInputRef = useRef(null)
  const resolutionRef = useRef(null)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() =>
        setHealth({
          weights_present: false,
          message: 'Backend offline. Start the FastAPI server on port 8000.',
        }),
      )
  }, [])

  useEffect(() => {
    if (!file) {
      setPreviewUrl('')
      setImageMeta(null)
      setTargetP(null)
      return undefined
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)

    const img = new Image()
    img.onload = () => {
      const width = img.naturalWidth
      const height = img.naturalHeight
      const short = Math.min(width, height)
      const currentTier = tierForShortSide(short)
      setImageMeta({ width, height, short, currentTier })
      setTargetP(firstReachableTarget(short, currentTier))
    }
    img.onerror = () => {
      setImageMeta(null)
      setTargetP(null)
      setError('Could not read image dimensions.')
    }
    img.src = url

    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    if (!busy) {
      setElapsed(0)
      return undefined
    }
    const started = Date.now()
    setElapsed(0)
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [busy])

  useEffect(() => {
    if (!openPicker || busy) return undefined
    fileInputRef.current?.click()
    setOpenPicker(false)
    return undefined
  }, [openPicker, mode, file, busy])

  useEffect(() => {
    if (!resolutionOpen) return undefined

    function onPointerDown(e) {
      if (!resolutionRef.current?.contains(e.target)) {
        setResolutionOpen(false)
      }
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') setResolutionOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [resolutionOpen])

  useEffect(() => {
    if (busy) setResolutionOpen(false)
  }, [busy])

  const usingUserImages = mode === 'user' && Boolean(file || result)

  useEffect(() => {
    setReveal(false)
    const id = requestAnimationFrame(() => setReveal(true))
    return () => cancelAnimationFrame(id)
  }, [usingUserImages, result, mode])

  function pickFile(next) {
    if (!next) return
    setMode('user')
    setFile(next)
    setResult(null)
    setError('')
    setSlider(50)
    setResolutionOpen(false)
  }

  function enterUserMode() {
    setMode('user')
    setError('')
  }

  function onDrop(e) {
    e.preventDefault()
    setDragActive(false)
    const next = e.dataTransfer.files?.[0]
    pickFile(next)
  }

  function updateSliderFromEvent(clientX) {
    const el = frameRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width)
    setSlider((x / rect.width) * 100)
  }

  function optionState(tier) {
    if (!imageMeta) return { disabled: true, reason: '' }
    const { short, currentTier } = imageMeta
    if (tier <= currentTier) {
      return { disabled: true, reason: 'at or below current' }
    }
    const scale = tier / short
    if (scale > MAX_OUTSCALE + 1e-6) {
      return { disabled: true, reason: 'needs more than 4×' }
    }
    return { disabled: false, reason: '' }
  }

  async function enhance() {
    if (!file || busy || !targetP) return
    setBusy(true)
    setError('')
    setResult(null)

    const body = new FormData()
    body.append('file', file)
    body.append('target_p', String(targetP))

    try {
      const res = await fetch('/api/enhance', { method: 'POST', body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = data.detail
        const message =
          typeof detail === 'string'
            ? detail
            : Array.isArray(detail)
              ? detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
              : 'Enhancement failed.'
        throw new Error(message)
      }
      setResult(data)
      setSlider(50)
    } catch (err) {
      setError(err.message || 'Enhancement failed.')
    } finally {
      setBusy(false)
    }
  }

  const weightsReady = health?.weights_present === true
  const isDemoStage = !usingUserImages
  const canEnhance = Boolean(file && targetP && weightsReady && !busy && imageMeta)

  let baseSrc = DEMO_AFTER
  let topSrc = DEMO_BEFORE
  if (usingUserImages && result) {
    baseSrc = result.enhanced_url
    topSrc = result.original_url
  } else if (usingUserImages && previewUrl) {
    baseSrc = previewUrl
    topSrc = null
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-[1100px] animate-clarity-fade-in content-start gap-4 px-4 pb-10 pt-5 sm:gap-5 sm:px-6 sm:pb-12 sm:pt-6 md:gap-6 md:px-8 md:pt-7 lg:px-10">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <header className="w-full max-w-3xl">
          <h1 className="mb-2 font-display text-[clamp(2rem,8vw,3.8rem)] font-extrabold leading-[0.95] tracking-[-0.04em]">
            Clarity
          </h1>
          <p className="m-0 max-w-2xl text-[0.95rem] leading-relaxed text-muted sm:text-[1.02rem] sm:leading-normal">
            Sharpen and upscale photos with Real-ESRGAN — free, local, and CPU-friendly.
          </p>
        </header>
      </div>

      <section className="grid gap-3 sm:gap-4 md:gap-[1.15rem]">
        <div className={cn(reveal && 'animate-clarity-reveal')}>
          <div
            className={cn(
              'relative min-h-[180px] touch-none select-none overflow-hidden rounded-clarity border border-ink/12 bg-[#050807] aspect-[4/3] sm:min-h-[200px] sm:aspect-video md:aspect-[2/1]',
              topSrc ? 'cursor-ew-resize' : 'cursor-default',
            )}
            ref={frameRef}
            onPointerDown={(e) => {
              if (!topSrc) return
              e.currentTarget.setPointerCapture(e.pointerId)
              updateSliderFromEvent(e.clientX)
            }}
            onPointerMove={(e) => {
              if (!topSrc || e.buttons !== 1) return
              updateSliderFromEvent(e.clientX)
            }}
          >
            <img
              className="absolute inset-0 h-full w-full object-contain object-center"
              src={baseSrc}
              alt={isDemoStage ? 'Demo enhanced' : 'Enhanced'}
              draggable={false}
            />
            {topSrc ? (
              <>
                <img
                  className="pointer-events-none absolute inset-0 h-full w-full object-contain object-center"
                  src={topSrc}
                  alt={isDemoStage ? 'Demo original' : 'Original'}
                  draggable={false}
                  style={{ clipPath: `inset(0 ${100 - slider}% 0 0)` }}
                />
                <div
                  className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-accent"
                  style={{ left: `${slider}%` }}
                >
                  <span className="absolute top-1/2 left-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-bg0/85 shadow-[0_0_0_1px_rgba(0,0,0,0.35)] sm:h-9 sm:w-9" />
                </div>
                <span className="pointer-events-none absolute top-2.5 left-2.5 z-10 rounded-md bg-[#080c0a]/72 px-2 py-1 text-[0.65rem] font-semibold tracking-[0.06em] text-ink uppercase sm:top-3.5 sm:left-3.5 sm:px-2.5 sm:text-[0.72rem]">
                  Before
                </span>
                <span className="pointer-events-none absolute top-2.5 right-2.5 z-10 rounded-md bg-[#080c0a]/72 px-2 py-1 text-[0.65rem] font-semibold tracking-[0.06em] text-ink uppercase sm:top-3.5 sm:right-3.5 sm:px-2.5 sm:text-[0.72rem]">
                  After
                </span>
              </>
            ) : null}

            {busy ? (
              <div
                className="absolute inset-0 z-20 grid place-content-center place-items-center gap-1.5 bg-[#080c0a]/62 p-4 text-center backdrop-blur-[2px] sm:p-6"
                role="status"
              >
                <div
                  className="mb-2 h-7 w-7 animate-spin rounded-full border-2 border-ink/20 border-t-accent"
                  aria-hidden="true"
                />
                <p className="m-0 font-display text-base font-bold sm:text-[1.1rem]">
                  Enhancing on CPU
                </p>
                <p className="m-0 max-w-[16rem] text-sm text-muted sm:max-w-none sm:text-[0.92rem]">
                  Running {formatElapsed(elapsed)} — larger photos take longer
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4">
          {mode === 'demo' ? (
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-3.5">
              <button type="button" className={primaryBtn} onClick={enterUserMode}>
                Try with your photo
              </button>
              <p className="m-0 text-center text-[0.92rem] text-muted sm:text-left">
                Drag the slider to compare the demo enhance.
              </p>
            </div>
          ) : (
            <>
              {!file ? (
                <div
                  className={cn(
                    'relative rounded-clarity border border-dashed border-ink/12 bg-bg0/45 px-4 py-6 text-center transition hover:-translate-y-0.5 hover:border-accent/55 hover:bg-bg1/75 sm:px-6 sm:py-7',
                    dragActive &&
                      '-translate-y-0.5 border-solid border-accent/55 bg-bg1/75 shadow-[0_0_0_1px_rgba(212,165,116,0.2)]',
                  )}
                  onDragEnter={(e) => {
                    e.preventDefault()
                    setDragActive(true)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragActive(true)
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={onDrop}
                >
                  <p className="mb-1.5 font-display text-base font-bold sm:text-[1.15rem]">
                    Drop a photo to sharpen
                  </p>
                  <p className="m-0 text-sm text-muted sm:text-[0.95rem]">
                    or tap to browse · JPG, PNG, WebP
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    onChange={(e) => pickFile(e.target.files?.[0])}
                  />
                </div>
              ) : (
                <div className="grid gap-3 sm:gap-4">
                  <div className="flex min-w-0 items-center gap-3 sm:gap-3.5">
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-[10px] border border-ink/12 bg-[#050807] object-cover sm:h-14 sm:w-14"
                      />
                    ) : null}
                    <div className="grid min-w-0 gap-0.5">
                      <p className="m-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium sm:text-[0.95rem]">
                        {file.name}
                      </p>
                      {imageMeta ? (
                        <p className="m-0 text-sm text-muted sm:text-[0.9rem]">
                          Length {imageMeta.width}px · Breadth {imageMeta.height}px ·{' '}
                          {tierLabel(imageMeta.currentTier)}
                        </p>
                      ) : (
                        <p className="m-0 text-sm text-muted sm:text-[0.9rem]">
                          Reading dimensions…
                        </p>
                      )}
                      <button
                        type="button"
                        className={cn(textLink, busy && 'pointer-events-none opacity-45')}
                        disabled={busy}
                        onClick={() => {
                          if (busy) return
                          setOpenPicker(true)
                        }}
                      >
                        Change photo
                      </button>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) => pickFile(e.target.files?.[0])}
                  />

                  <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3.5">
                    <div className="grid w-full min-w-0 flex-1 gap-1.5 sm:min-w-[12rem] md:max-w-xs">
                      <span
                        id="target-resolution-label"
                        className="text-[0.8rem] tracking-[0.04em] text-muted uppercase"
                      >
                        Target resolution
                      </span>
                      <div className="relative" ref={resolutionRef}>
                        <button
                          type="button"
                          id="target-resolution"
                          className="resolution-select resolution-trigger w-full rounded-full text-left outline-none transition disabled:cursor-not-allowed disabled:opacity-55"
                          aria-haspopup="listbox"
                          aria-expanded={resolutionOpen}
                          aria-labelledby="target-resolution-label"
                          disabled={busy || !imageMeta}
                          onClick={() => setResolutionOpen((open) => !open)}
                        >
                          {targetP ? `${targetP}p` : 'No higher resolution available'}
                        </button>

                        {resolutionOpen ? (
                          <ul
                            className="resolution-menu"
                            role="listbox"
                            aria-labelledby="target-resolution-label"
                          >
                            {RESOLUTION_TIERS.map((tier) => {
                              const { disabled, reason } = optionState(tier)
                              const selected = targetP === tier
                              return (
                                <li key={tier} role="option" aria-selected={selected} aria-disabled={disabled}>
                                  <button
                                    type="button"
                                    className={cn(
                                      'resolution-option',
                                      selected && 'is-selected',
                                      disabled && 'is-disabled',
                                    )}
                                    disabled={disabled}
                                    onClick={() => {
                                      if (disabled) return
                                      setTargetP(tier)
                                      setResolutionOpen(false)
                                    }}
                                  >
                                    {tier}p
                                    {disabled && reason ? (
                                      <span className="resolution-option-reason"> ({reason})</span>
                                    ) : null}
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        ) : null}
                      </div>
                    </div>

                    <button
                      type="button"
                      className={primaryBtn}
                      disabled={!canEnhance}
                      onClick={enhance}
                    >
                      {busy
                        ? `Enhancing… ${formatElapsed(elapsed)}`
                        : targetP
                          ? `Enhance to ${targetP}p`
                          : 'Enhance'}
                    </button>
                  </div>
                </div>
              )}

              {result ? (
                <div className="flex flex-col flex-wrap gap-3 sm:flex-row sm:items-center">
                  <a className={ghostBtn} href={result.download_url} download>
                    Download enhanced PNG
                  </a>
                  <a
                    className={ghostBtn}
                    href={result.enhanced_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open full size
                  </a>
                  {result.output_size ? (
                    <p className="m-0 text-center text-sm text-muted sm:self-center sm:text-left sm:text-[0.9rem]">
                      Output Length {result.output_size.width}px · Breadth{' '}
                      {result.output_size.height}px
                      {result.target_p ? ` · ${result.target_p}p` : ''}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}

          {error ? (
            <p className="m-0 break-words text-sm text-danger sm:text-[0.95rem]">{error}</p>
          ) : null}

          {health && !weightsReady && mode === 'user' ? (
            <p className="m-0 break-words text-sm text-danger sm:text-[0.95rem]">
              {health.message ||
                'Place RealESRGAN_x4plus.pth in the weights/ folder, then restart the backend.'}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  )
}
