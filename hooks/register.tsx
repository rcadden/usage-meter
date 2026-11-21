import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'usage-meter', key: 'limits' } as const, [] as Limit[])
const now = atom({ plugin: 'usage-meter', key: 'now' } as const, 0)

const LABELS: Record<string, string> = { five_hour: '5H', seven_day: '7D' }

const ring = (pct: number) =>
  pct >= 87.5 ? '●' : pct >= 62.5 ? '◕' : pct >= 37.5 ? '◑' : pct >= 12.5 ? '◔' : '○'

// Hue stops [percent, hue]: solid green to 50%, yellow by 62% and held to ~76%, red by 95%.
// Hue is interpolated, so the blend stays bright instead of passing through mustard.
const STOPS: [number, number][] = [
  [0, 140],
  [50, 140],
  [62, 50],
  [76, 42],
  [95, 0],
]

function ringColor(pct: number) {
  const p = Math.min(100, Math.max(0, pct))
  let hue = 0
  for (let i = 1; i < STOPS.length; i++) {
    const [p0, h0] = STOPS[i - 1]!
    const [p1, h1] = STOPS[i]!
    if (p <= p1) {
      hue = h0 + ((h1 - h0) * (p - p0)) / (p1 - p0)
      break
    }
  }
  return `hsl(${Math.round(hue)},85%,46%)`
}

function ringSvg(pct: number) {
  const r = 11
  const c = 2 * Math.PI * r
  const arc = (Math.min(100, Math.max(0, pct)) / 100) * c
  const color = ringColor(pct)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
    `<circle cx="14" cy="14" r="${r}" fill="none" stroke="#808080" stroke-opacity="0.45" stroke-width="4"/>` +
    `<circle cx="14" cy="14" r="${r}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" ` +
    `stroke-dasharray="${arc} ${c}" transform="rotate(-90 14 14)"/></svg>`
  )
}

const timeLeft =(resetsAt: string | undefined, at: number) => {
  if (!resetsAt) return ''
  const mins = Math.max(0, Math.round((Date.parse(resetsAt) - at) / 60000))
  const d = Math.floor(mins / 1440)
  const hr = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  const text = d > 0 ? `${d}d ${hr}h` : hr > 0 ? `${hr}h ${m}m` : `${m}m`
  return `${text} left`
}

async function refresh($: EngineInterface) {
  const usage = await $.session.usage()
  await update($, limits, () => usage.rateLimits as Limit[])
  await update($, now, () => Date.now())
}

const PANE = 'usage-meter'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refresh($)
    $.clock.every(60000, () => refresh($))
    await $.command.register({ name: 'meter', description: 'Show 5H / 7D usage limits in a pane' })
    if ((await $.session.surfaces()).includes('mobile')) {
      void $.ui.open({ id: PANE, title: 'Usage' })
    }
    return next(e)
  })

  on('session.attach', { surface: 'mobile' }, async ($, e, next) => {
    void $.ui.open({ id: PANE, title: 'Usage' })
    return next(e)
  })

  on('command.run', { command: 'meter' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Usage' })
    return { text: 'Usage pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const rows = (await read($, limits)).filter(l => LABELS[l.kind])
    const at = await read($, now)
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const Svg = (els as any).Svg as any

    if (rows.length === 0) {
      return (
        <Box>
          <Text size="body">Waiting for usage data…</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {rows.map(l => {
          const hot = l.percentUsed >= 85
          return (
            <Box key={l.kind} flexDirection="row" alignItems="center" gap={2}>
              {Svg ? (
                <Svg
                  source={ringSvg(l.percentUsed)}
                  alt={`${LABELS[l.kind]} usage ${Math.round(l.percentUsed)}%`}
                  width={36}
                  height={36}
                />
              ) : (
                <Text size="title">{ring(l.percentUsed)}</Text>
              )}
              <Box flexDirection="column">
                <Box flexDirection="row" alignItems="center" gap={1}>
                  <Text size="footnote" weight="regular">
                    {LABELS[l.kind]}
                  </Text>
                  <Text size="title" weight="bold" color={hot ? 'red' : undefined}>
                    {Math.round(l.percentUsed)}%
                  </Text>
                </Box>
                {l.resetsAt ? (
                  <Text size="footnote" weight="regular">
                    {timeLeft(l.resetsAt, at)}
                  </Text>
                ) : null}
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })

  on('session.measure', async ($, e, next) => {
    await update($, limits, () => e.rateLimits as Limit[])
    await update($, now, () => Date.now())
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rows = (await read($, limits)).filter(l => LABELS[l.kind])
    if (e.props.hasSurvey) return next(e)

    const at = await read($, now)
    const { Box, Text } = $.ui.resolve(e)

    if (rows.length === 0) {
      return (
        <Box>
          <Text size="body" weight="medium">○ 5H –  ○ 7D –  (waiting for usage data)</Text>
        </Box>
      )
    }

    const Svg = (e.surface === 'terminal' ? undefined : (($.ui.resolve(e) as any).Svg)) as any

    return (
      <Box flexDirection="row" alignItems="center" gap={3}>
        {rows.map(l => {
          const hot = l.percentUsed >= 85
          return (
            <Box key={l.kind} flexDirection="row" alignItems="center" gap={1}>
              {Svg ? (
                <Svg
                  source={ringSvg(l.percentUsed)}
                  alt={`${LABELS[l.kind]} usage ${Math.round(l.percentUsed)}%`}
                  width={18}
                  height={18}
                />
              ) : (
                <Text size="body">{ring(l.percentUsed)}</Text>
              )}
              <Text size="footnote" weight="regular">
                {LABELS[l.kind]}
              </Text>
              <Text size="heading" weight="bold" color={hot ? 'red' : undefined}>
                {Math.round(l.percentUsed)}%
              </Text>
              {l.resetsAt ? (
                <Text size="footnote" weight="regular">
                  {timeLeft(l.resetsAt, at)}
                </Text>
              ) : null}
            </Box>
          )
        })}
      </Box>
    )
  })
}
