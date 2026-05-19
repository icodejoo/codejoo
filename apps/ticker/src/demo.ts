import { Ticker, ease, tween, animate, countDown, countUp } from './index'

Ticker.extends(tween())
Ticker.extends(animate()) // animate 依赖 tween
Ticker.extends(countDown())
Ticker.extends(countUp())

const ticker = new Ticker()

const cuEl = document.getElementById('cu')!
const cdEl = document.getElementById('cd')!
const intLog = document.getElementById('intLog')!

let cuCtrl: ReturnType<Ticker['countUp']> | null = null

document.getElementById('cuStart')!.addEventListener('click', () => {
  cuCtrl?.remove()
  cuCtrl = ticker.countUp(99999, { el: cuEl, prefix: '₱', duration: 1500 })
})

document.getElementById('cuUpdate')!.addEventListener('click', () => {
  cuCtrl?.update(999999)
})

document.getElementById('cdStart')!.addEventListener('click', () => {
  ticker.countDown(60_000, txt => (cdEl.textContent = txt))
})

document.getElementById('tweenTo')!.addEventListener('click', () => {
  ticker.to('#box', { left: 300, duration: 600, ease: ease.easeOutCubic })
})

document.getElementById('tweenFromTo')!.addEventListener('click', () => {
  ticker.fromTo('#box', { x: 0 }, { x: 300, duration: 600, ease: ease.easeInOutCubic })
})

document.getElementById('tweenYoyo')!.addEventListener('click', () => {
  ticker.to('#box', { left: 300, duration: 400, repeat: 3, yoyo: true })
})

document.getElementById('animate')!.addEventListener('click', () => {
  ticker.animate('#box', { left: '+=100' }, 400)
})

document.getElementById('reset')!.addEventListener('click', () => {
  const box = document.getElementById('box') as HTMLElement
  box.style.left = '0px'
  box.style.top = '8px'
  box.style.transform = 'none'
})

let intId: number | null = null
let counter = 0
document.getElementById('setInt')!.addEventListener('click', () => {
  if (intId !== null) ticker.remove(intId)
  counter = 0
  intId = ticker.setInterval(() => {
    counter++
    intLog.textContent = String(counter)
  }, 1000)
})

document.getElementById('pause')!.addEventListener('click', () => ticker.pause())
document.getElementById('resume')!.addEventListener('click', () => ticker.resume())
document.getElementById('stop')!.addEventListener('click', () => {
  ticker.stop()
  if (intId !== null) {
    ticker.remove(intId)
    intId = null
  }
})
