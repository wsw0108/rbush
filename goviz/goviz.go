package main

<<<<<<< HEAD
import "github.com/gopherjs/gopherjs/js"
import "github.com/tidwall/rbush"
=======
import (
	"math"
	"math/rand"
	"time"

	"github.com/gopherjs/gopherjs/js"
	"github.com/tidwall/rbush"
)

const (
	githubLink = "http://github.com/tidwall/rbush"
	githubText = "github.com/tidwall/rbush"
)
>>>>>>> track

func main() {
	sheet := js.Global.Get("document").Call("createElement", "style")
	sheet.Set("innerHTML",
		`html, body { 
			padding:0; margin:0; border:0; width:100%; height:100%; overflow:hidden;
		}
		html{
			background: black;
		}`)
	js.Global.Get("document").Get("head").Call("appendChild", sheet)
	js.Global.Get("document").Set("title", "uh huh")
	js.Global.Call("addEventListener", "load", func() {
<<<<<<< HEAD
		var tree = NewTree(js.Global.Get("document").Get("body"))
=======
>>>>>>> track
		cover := js.Global.Get("document").Call("createElement", "div")
		cover.Get("style").Set("height", "100%")
		cover.Get("style").Set("width", "100%")
		cover.Get("style").Set("background-image", "radial-gradient(ellipse farthest-corner at 45px 45px , #00FFFF 0%, rgba(0, 0, 255, 0) 50%, #0000FF 95%)")
		cover.Get("style").Set("opacity", "0.15")
		cover.Get("style").Set("position", "absolute")
<<<<<<< HEAD
		js.Global.Call("addEventListener", "resize", func() {
			tree.layout()
		})
		js.Global.Get("document").Get("body").Call("appendChild", cover)
	})
}

type Tree struct {
	tr *rbush.RBush
}

func NewTree(o *js.Object) *Tree {
	t := &Tree{
		tr: rbush.New(16),
	}
	return t
}
func genData(N, M, R int) rbush.Node {
	/*
	   var data = [];
	   for (var i = 0; i < M; i++) {
	       var cluster = randClusterPoint(R);
	       var size = Math.min(Math.ceil(N / M), N - data.length);
	       for (var j = 0; j < size; j++) {
	           data.push(randClusterBox(cluster, R, 1));
	       }
	   }
	   return data;
	*/
}

func (t *Tree) insertOneByOne(n int) {
	/*
	   return function () {
	           var data2 = genData(K, M, R);
	           console.time('insert ' + K + ' items');
	           for (var i = 0; i < K; i++) {
	               tree.insert(data2[i]);
	           }
	           console.timeEnd('insert ' + K + ' items');
	           data = data.concat(data2);
	           draw();
	       };
	*/
}
func (t *Tree) layout() {

=======
		js.Global.Get("document").Get("body").Call("appendChild", cover)
		var tree = NewTree(js.Global.Get("document").Get("body"))
		js.Global.Call("addEventListener", "resize", func() {
			tree.layout()
		})
	})
}

func randi() int {
	return int(js.Global.Get("Math").Call("random").Float() * 2147483647.0)
}
func itoa(i int) string {
	return js.Global.Get("String").New(i).String()
}
func ftoa(f float64) string {
	return js.Global.Get("String").New(f).String()
}

const W = 1000
const N = 7500
const M = 30
const R = 100

type Tree struct {
	tr             *rbush.RBush
	data           []*rbush.Node
	parent         *js.Object
	canvas         *js.Object
	width, height  float64
	ratio          float64
	ctx            *js.Object
	rects          []rectT
	ts             float64
	dirty          bool
	linkover       bool
	Clicked        func()
	showWireframes bool
}

func NewTree(parent *js.Object) *Tree {
	t := &Tree{
		tr:     rbush.New(16),
		parent: parent,
		dirty:  true,
	}
	t.genBulkInsert(N, M)
	t.rects = t.buildRects(nil, t.tr.Data, 0)
	t.start()
	return t
}

func (t *Tree) start() {
	var raf string
	for _, s := range []string{"requestAnimationFrame", "webkitRequestAnimationFrame", "mozRequestAnimationFrame"} {
		if js.Global.Get(s) != js.Undefined {
			raf = s
			break
		}
	}
	if raf == "" {
		panic("requestAnimationFrame is not available")
	}
	defer t.layout()
	var f func(*js.Object)
	f = func(timestampJS *js.Object) {
		js.Global.Call(raf, f)
		t.loop(timestampJS.Float() / 1000)
	}
	js.Global.Call(raf, f)
}

type pointT struct {
	x, y float64
}

func (t *Tree) genBulkInsert(K, M int) {
	var data2 = genRandomData(K)
	consoleTime("bulk-insert " + itoa(K) + " items")
	t.tr.Load(data2)
	consoleTimeEnd("bulk-insert " + itoa(K) + " items")
	t.data = append(t.data, data2...)
}
func genRandomData(N int) []*rbush.Node {
	rand.Seed(time.Now().UnixNano())
	var data []*rbush.Node
	for i := 0; i < N; i++ {
		w := 1 * rand.Float64()
		h := 1 * rand.Float64()
		x := (W - w) * rand.Float64()
		y := (W - w) * rand.Float64()
		data = append(data, &rbush.Node{
			MinX: x,
			MinY: y,
			MaxX: x + w,
			MaxY: y + h,
			Item: true,
		})
	}
	return data
}

var start time.Time

func consoleTime(s string) {
	start = time.Now()
}
func consoleTimeEnd(s string) {
	end := time.Since(start)
	println(s + ": " + itoa(int(end/time.Millisecond)) + "ms")
}

func (t *Tree) layout() {
	ratio := js.Global.Get("devicePixelRatio").Float()
	width := t.parent.Get("offsetWidth").Float() * ratio
	height := t.parent.Get("offsetHeight").Float() * ratio
	if t.canvas != nil && t.width == width && t.height == height && t.ratio == ratio {
		return
	}
	t.width, t.height, t.ratio = width, height, ratio
	if t.canvas != nil {
		t.parent.Call("removeChild", t.canvas)
	}
	t.canvas = js.Global.Get("document").Call("createElement", "canvas")
	t.ctx = t.canvas.Call("getContext", "2d")
	t.canvas.Set("width", t.width)
	t.canvas.Set("height", t.height)
	t.canvas.Get("style").Set("width", ftoa(t.width/t.ratio)+"px")
	t.canvas.Get("style").Set("height", ftoa(t.height/t.ratio)+"px")
	t.canvas.Get("style").Set("position", "absolute")
	t.parent.Call("appendChild", t.canvas)
	t.canvas.Call("addEventListener", "click", func(ev *js.Object) {
		if t.overLink(ev.Get("x").Int(), ev.Get("y").Int()) {
			js.Global.Set("location", githubLink)
		} else {
			if t.Clicked != nil {
				t.Clicked()
			}
		}
	})
	t.canvas.Call("addEventListener", "mousemove", func(ev *js.Object) {
		if t.overLink(ev.Get("x").Int(), ev.Get("y").Int()) {
			t.canvas.Get("style").Set("cursor", "pointer")
			t.linkover = true
		} else {
			t.canvas.Get("style").Set("cursor", "default")
			t.linkover = false
		}
	})
	t.Clicked = func() {
		t.showWireframes = !t.showWireframes
	}
	t.dirty = true
}
func (t *Tree) overLink(x, y int) bool {
	return x > int(t.width/t.ratio)-320 && y > int(t.height/t.ratio)-50
}

type rectT struct {
	color     string
	stroke    float64
	node      *rbush.Node
	ts        float64
	dur       float64
	backwards bool
	loop      int
}

var leafColor = "rgba(200,39,33,"
var colors = []string{
	//"rgba(" + itoa(0x00) + "," + itoa(0xbb) + "," + itoa(0x66) + ",", // + ",1.0)",
	"rgba(" + itoa(0x00) + "," + itoa(0x00) + "," + itoa(0xff) + ",",
	"rgba(" + itoa(0xff) + "," + itoa(0x00) + "," + itoa(0xff) + ",",
	//"rgba(" + itoa(0xff) + "," + itoa(0x44) + "," + itoa(0x00) + ",", // + ",1.0)",
}

func (t *Tree) buildRects(rects []rectT, node *rbush.Node, level int) []rectT {
	if node == nil {
		return rects
	}
	var rect rectT
	if node.Leaf {
		rect.color = leafColor
		rect.stroke = 0.8
	} else {
		if level == 0 {
			rect.color = "grey"
		} else {
			rect.color = colors[(node.Height-1)%len(colors)]
		}

		if level == 0 {
			rect.stroke = 0.2
		} else {
			rect.stroke = 1 / math.Pow(float64(level), 1.0)
		}
		rect.stroke = 0.8
	}
	rect.node = node
	rects = append(rects, rect)
	if node.Leaf {
		return rects
	}
	if level == 6 {
		return rects
	}
	for _, child := range node.Children {
		rects = t.buildRects(rects, child, level+1)
	}
	return rects
}

var pad = 50.0

func (t *Tree) tx(x float64) float64 {
	if t.width > t.height {
		x = x / W * (t.height - (pad * 2 * t.ratio))
	} else {
		x = x / W * (t.width - (pad * 2 * t.ratio))
	}
	return x
}

func (t *Tree) ty(y float64) float64 {
	if t.width > t.height {
		y = y / W * (t.height - (pad * 2 * t.ratio))
	} else {
		y = y / W * (t.width - (pad * 2 * t.ratio))
	}
	return y
}

func (t *Tree) draw() {
	if !t.dirty {
		//		return
	}
	t.ctx.Call("clearRect", 0, 0, t.width, t.height)
	t.ctx.Set("fillStyle", "rgba(0,128,255,0.05)")
	var stroke float64
	for i := len(t.rects) - 1; i >= 0; i-- {
		rect := t.rects[i]
		var opacity float64
		if rect.node.Leaf {
			if rect.ts == 0 {
				rect.ts = t.ts
				if rect.loop == 0 {
					rect.dur = rand.Float64()*1 + 0.5
				} else {
					rect.dur = rand.Float64()*1 + 0.5
				}
			}
			diff := (t.ts - rect.ts)
			if rect.backwards {
				opacity = 1 - (diff / rect.dur)
				if opacity < 0.5 {
					opacity = 0.5
					rect.ts = 0
					rect.backwards = !rect.backwards
					rect.loop++
				}
			} else {
				opacity = diff / rect.dur
				if rect.loop > 0 {
					opacity = opacity*0.5 + 0.5
				}
				if opacity > 1 {
					opacity = 1
					rect.ts = 0
					rect.backwards = !rect.backwards
					rect.loop++
				}
			}
		} else {
			if t.showWireframes {
				opacity = 1
			}
		}
		x := t.tx(rect.node.MinX)
		y := t.ty(rect.node.MinY)
		w := (t.tx(rect.node.MaxX) - t.tx(rect.node.MinX))
		h := (t.ty(rect.node.MaxY) - t.ty(rect.node.MinY))
		if t.width > t.height {
			x += t.width/2 - (t.height-pad*t.ratio)/2 + pad/2*t.ratio
			y += pad * t.ratio
		} else {
			x += pad * t.ratio
			y += t.height/2 - (t.width-pad*t.ratio)/2 + pad/2*t.ratio
		}
		t.ctx.Set("strokeStyle", rect.color+ftoa(opacity)+")")
		if rect.stroke != stroke {
			t.ctx.Set("lineWidth", rect.stroke*t.ratio)
			stroke = rect.stroke
		}
		if rect.node.Leaf {
			if t.showWireframes {
				t.ctx.Call("beginPath")
				for _, child := range rect.node.Children {
					x := t.tx(child.MinX)
					y := t.ty(child.MinY)
					if t.width > t.height {
						x += t.width/2 - (t.height-pad*t.ratio)/2 + pad/2*t.ratio
						y += pad * t.ratio
					} else {
						x += pad * t.ratio
						y += t.height/2 - (t.width-pad*t.ratio)/2 + pad/2*t.ratio
					}
					t.ctx.Call("moveTo", x, y)
					t.ctx.Call("arc", x, y, 1*t.ratio, 0, 1*math.Pi, false)
					t.ctx.Call("fill")
				}
			}
			t.strokeRect(x, y, w, h, 5*t.ratio)
		} else {
			t.strokeRect(x, y, w, h, 1*t.ratio)
		}
		t.rects[i] = rect
	}
	t.drawTitles()
}
func (t *Tree) strokeRect(x, y, width, height, radius float64) {
	if radius*2 > width {
		radius = width / 2
	}
	if radius*2 > height {
		radius = height / 2
	}
	t.ctx.Call("beginPath")
	t.ctx.Call("moveTo", x+radius, y)
	t.ctx.Call("lineTo", x+width-radius, y)
	t.ctx.Call("quadraticCurveTo", x+width, y, x+width, y+radius)
	t.ctx.Call("lineTo", x+width, y+height-radius)
	t.ctx.Call("quadraticCurveTo", x+width, y+height, x+width-radius, y+height)
	t.ctx.Call("lineTo", x+radius, y+height)
	t.ctx.Call("quadraticCurveTo", x, y+height, x, y+height-radius)
	t.ctx.Call("lineTo", x, y+radius)
	t.ctx.Call("quadraticCurveTo", x, y, x+radius, y)
	t.ctx.Call("closePath")
	t.ctx.Call("stroke")
}
func (t *Tree) loop(dur float64) {
	t.ts = dur
	t.draw()
}
func (t *Tree) drawTitles() {
	y := float64(0)
	if t.linkover {
		y = t.drawTitle(githubText, leafColor+"1.0)", 15*t.ratio, y)
	} else {
		y = t.drawTitle(githubText, leafColor+"0.7)", 15*t.ratio, y)
	}
}
func (t *Tree) drawTitle(text string, color string, fontSize float64, y float64) float64 {
	ny := y + (fontSize * 1.5)
	pad := 15 * t.ratio
	x := t.width - pad
	y = t.height - pad - y
	t.ctx.Call("save")
	t.ctx.Set("font", itoa(int(fontSize))+"px Menlo, Consolas, Monospace, Helvetica, Arial, Sans-Serif")
	t.ctx.Set("textAlign", "right")
	t.ctx.Set("lineWidth", 0)
	t.ctx.Set("shadowColor", color)
	t.ctx.Set("shadowBlur", float64(fontSize))
	t.ctx.Set("fillStyle", color)
	t.ctx.Call("fillText", text, x, y)
	t.ctx.Call("restore")
	return ny
>>>>>>> track
}
