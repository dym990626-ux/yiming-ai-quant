import { useEffect, useRef } from 'react'
import { AreaSeries, ColorType, createChart, type UTCTimestamp } from 'lightweight-charts'

export function EquityChart({ data }: { data: { time: number; value: number }[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || data.length < 2) return
    const chart = createChart(ref.current, { height: 220, layout: { background: { type: ColorType.Solid, color: '#fff' }, textColor: '#667085' }, grid: { vertLines: { color: '#f2f4f7' }, horzLines: { color: '#f2f4f7' } }, rightPriceScale: { borderColor: '#eaecf0' }, timeScale: { borderColor: '#eaecf0', timeVisible: true } })
    const series = chart.addSeries(AreaSeries, { lineColor: '#1570ef', topColor: 'rgba(21,112,239,.22)', bottomColor: 'rgba(21,112,239,.01)', lineWidth: 2, priceLineVisible: false })
    series.setData(data.map(point => ({ ...point, time: point.time as UTCTimestamp }))); chart.timeScale().fitContent()
    const observer = new ResizeObserver(() => chart.applyOptions({ width: ref.current?.clientWidth ?? 0 })); observer.observe(ref.current)
    return () => { observer.disconnect(); chart.remove() }
  }, [data])
  return <div className="equity-chart" ref={ref} />
}
