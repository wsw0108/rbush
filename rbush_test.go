package rbush_test

import (
	"fmt"
	"math"
	"math/rand"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/fogleman/gg"
	"github.com/stretchr/testify/assert"
	"github.com/tidwall/pinhole"
	"github.com/tidwall/rbush"
)

type rect struct {
	min, max []float64
}

func (r *rect) Rect() (min, max []float64) {
	return r.min, r.max
}

type point struct {
	point []float64
}

func (p *point) Rect() (min, max []float64) {
	return p.point, p.point
}

func makePoint(values ...float64) rbush.Item {
	return &point{values}
}

func makeRect(values ...float64) rbush.Item {
	return &rect{values[:len(values)/2], values[len(values)/2:]}
}
func TestBasic(t *testing.T) {
	for i := 1; i <= 5; i++ {
		testBasic(t, i)
	}
}
func testBasic(t *testing.T, dims int) {
	tr := rbush.New(dims)
	p1 := makePoint([]float64{-115, 33, 1, 10, 100}[:dims]...)
	p2 := makePoint([]float64{-113, 35, 2, 20, 200}[:dims]...)
	tr.Insert(p1)
	tr.Insert(p2)
	assert.Equal(t, 2, tr.Count())

	var points []rbush.Item
	tr.Search(makeRect(append(
		[]float64{-116, 32, -1, -10, -100}[:dims],
		[]float64{-114, 34, 1, 10, 100}[:dims]...,
	)...), func(item rbush.Item) bool {
		points = append(points, item)
		return true
	})
	assert.Equal(t, 1, len(points))
	tr.Remove(p1)
	assert.Equal(t, 1, tr.Count())

	points = nil
	tr.Search(makeRect(append(
		[]float64{-116, 33, 10, 100, 1000}[:dims],
		[]float64{-114, 34, 11, 110, 1100}[:dims]...,
	)...), func(item rbush.Item) bool {
		points = append(points, item)
		return true
	})
	assert.Equal(t, 0, len(points))
	tr.Remove(p2)
	assert.Equal(t, 0, tr.Count())
}

func getMemStats() runtime.MemStats {
	runtime.GC()
	time.Sleep(time.Millisecond)
	runtime.GC()
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	return ms
}

func makeRandom(what string, dims int) rbush.Item {
	if what == "point" {
		values := make([]float64, dims)
		for i := 0; i < dims; i++ {
			values[i] = rand.Float64()*100 - 50 // -50/+50
		}
		return makePoint(values...)
	} else if what == "rect" {
		values := make([]float64, dims*2)
		for i := 0; i < dims; i++ {
			v := rand.Float64()*100 - 50
			values[i] = v - rand.Float64()*10
			values[len(values)/2+i] = v + rand.Float64()*10
		}
		return makeRect(values...)
	}
	panic("??")
}

func TestRandomPoints(t *testing.T) {
	for i := 1; i <= 5; i++ {
		testRandom(t, "point", 10000, i)
	}
}

func TestRandomRects(t *testing.T) {
	for i := 1; i <= 5; i++ {
		testRandom(t, "rect", 10000, i)
	}
}

func testRandom(t *testing.T, which string, n int, dims int) {
	fmt.Printf("===========================\n")
	fmt.Printf("Random %dD %s test\n", dims, which)
	fmt.Printf("===========================\n")
	rand.Seed(time.Now().UnixNano())
	tr := rbush.New(dims)
	min, max := tr.Bounds()
	assert.Equal(t, make([]float64, dims), min)
	assert.Equal(t, make([]float64, dims), max)

	// create random objects
	m1 := getMemStats()
	objs := make([]rbush.Item, n)
	for i := 0; i < n; i++ {
		objs[i] = makeRandom(which, dims)
	}

	// insert the objects into tree
	m2 := getMemStats()
	start := time.Now()
	for _, r := range objs {
		tr.Insert(r)
	}
	durInsert := time.Since(start)
	m3 := getMemStats()
	assert.Equal(t, len(objs), tr.Count())
	fmt.Printf("Inserted %d random %ss in %dms -- %d ops/sec\n",
		len(objs), which, int(durInsert.Seconds()*1000),
		int(float64(len(objs))/durInsert.Seconds()))
	fmt.Printf("  total cost is %d bytes/%s -- tree overhead %d%%\n",
		int(m3.HeapAlloc-m1.HeapAlloc)/len(objs),
		which,
		int((float64(m3.HeapAlloc-m2.HeapAlloc)/float64(len(objs)))/
			(float64(m3.HeapAlloc-m1.HeapAlloc)/float64(len(objs)))*100))

	// count all nodes and leaves
	var nodes int
	var leaves int
	var maxLevel int
	tr.Traverse(func(min, max []float64, level int, item rbush.Item) bool {
		if level != 0 {
			nodes++
		}
		if level == 1 {
			leaves++
		}
		if level > maxLevel {
			maxLevel = level
		}
		return true
	})
	fmt.Printf("  nodes: %d, leaves: %d, level: %d\n", nodes, leaves, maxLevel)

	// verify mbr

	min, max = nil, nil
	for i := 0; i < dims; i++ {
		min = append(min, math.Inf(+1))
		max = append(max, math.Inf(-1))
	}
	for _, o := range objs {
		minb, maxb := o.Rect()
		for i := 0; i < len(min); i++ {
			if minb[i] < min[i] {
				min[i] = minb[i]
			}
			if maxb[i] > max[i] {
				max[i] = maxb[i]
			}
		}
	}
	minb, maxb := tr.Bounds()
	assert.Equal(t, min, minb)
	assert.Equal(t, max, maxb)

	// scan
	var arr []rbush.Item
	tr.Scan(func(item rbush.Item) bool {
		arr = append(arr, item)
		return true
	})
	assert.True(t, testHasSameItems(objs, arr))

	// search
	testSearch(t, tr, objs, 0.10, true)
	testSearch(t, tr, objs, 0.50, true)
	testSearch(t, tr, objs, 1.00, true)

	// knn
	testKNN(t, tr, objs, 100, true)
	testKNN(t, tr, objs, 1000, true)
	testKNN(t, tr, objs, 10000, true)
	testKNN(t, tr, objs, n*2, true) // all of them

	// remove all objects
	indexes := rand.Perm(len(objs))
	start = time.Now()
	for _, i := range indexes {
		tr.Remove(objs[i])
	}
	durRemove := time.Since(start)
	assert.Equal(t, 0, tr.Count())
	fmt.Printf("Removed %d %ss in %dms -- %d ops/sec\n",
		len(objs), which, int(durRemove.Seconds()*1000),
		int(float64(len(objs))/durRemove.Seconds()))

	min, max = tr.Bounds()
	assert.Equal(t, make([]float64, dims), min)
	assert.Equal(t, make([]float64, dims), max)
}
func testKNN(t *testing.T, tr *rbush.RBush, objs []rbush.Item, n int, check bool) {
	min, max := tr.Bounds()
	var center []float64
	for i := 0; i < len(min); i++ {
		center = append(center, (max[i]+min[i])/2)
	}

	// gather the results, make sure that is matches exactly
	var arr1 []rbush.Item
	var dists1 []float64
	pdist := math.Inf(-1)
	tr.KNN(center, func(item rbush.Item, dist float64) bool {
		if len(arr1) == n {
			return false
		}
		arr1 = append(arr1, item)
		dists1 = append(dists1, dist)
		if dist < pdist {
			panic("dist out of order")
		}
		pdist = dist
		return true
	})
	assert.True(t, n > len(objs) || n == len(arr1))

	// get the KNN for the original array
	nobjs := make([]rbush.Item, len(objs))
	copy(nobjs, objs)
	sort.Slice(nobjs, func(i, j int) bool {
		imin, imax := nobjs[i].Rect()
		jmin, jmax := nobjs[j].Rect()
		idist := testBoxDist(center, imin, imax)
		jdist := testBoxDist(center, jmin, jmax)
		return idist < jdist
	})
	arr2 := nobjs[:len(arr1)]
	var dists2 []float64
	for i := 0; i < len(arr2); i++ {
		min, max := arr2[i].Rect()
		dist := testBoxDist(center, min, max)
		dists2 = append(dists2, dist)
	}
	// only compare the distances, not the objects because rectangles with
	// a dist of zero will not be ordered.
	assert.Equal(t, dists1, dists2)

}
func testBoxDist(point []float64, min, max []float64) float64 {
	var dist float64
	for i := 0; i < len(point); i++ {
		d := testAxisDist(point[i], min[i], max[i])
		if i == 0 {
			dist = d * d
		} else {
			dist += d * d
		}
	}
	return dist
}
func testAxisDist(k, min, max float64) float64 {
	if k < min {
		return min - k
	}
	if k <= max {
		return 0
	}
	return k - max
}
func testSearch(t *testing.T, tr *rbush.RBush, objs []rbush.Item, percent float64, check bool) {
	min, max := tr.Bounds()
	values := make([]float64, len(min)*2)
	for i := 0; i < len(min); i++ {
		values[i] = ((max[i]+min[i])/2 - ((max[i]-min[i])*percent)/2)
		values[len(values)/2+i] = ((max[i]+min[i])/2 + ((max[i]-min[i])*percent)/2)
	}
	box := makeRect(values...)
	var arr1 []rbush.Item
	tr.Search(box, func(item rbush.Item) bool {
		if check {
			arr1 = append(arr1, item)
		}
		return true
	})
	if !check {
		return
	}
	var arr2 []rbush.Item
	for _, obj := range objs {
		if testIntersects(obj, box) {
			arr2 = append(arr2, obj)
		}
	}
	assert.Equal(t, len(arr1), len(arr2))
	for _, o1 := range arr1 {
		var found bool
		for _, o2 := range arr2 {
			if o2 == o1 {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("not found")
		}
	}
}

func testIntersects(obj, box rbush.Item) bool {
	amin, amax := obj.Rect()
	bmin, bmax := box.Rect()
	for i := 0; i < len(amin); i++ {
		if !(bmin[i] <= amax[i] && bmax[i] >= amin[i]) {
			return false
		}
	}
	return true
}
func testHasSameItems(a1, a2 []rbush.Item) bool {
	if len(a1) != len(a2) {
		return false
	}
	for _, p1 := range a1 {
		var found bool
		for _, p2 := range a2 {
			if p1 == p2 {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func TestOutput3DPNG(t *testing.T) {
	rand.Seed(time.Now().UnixNano())
	tr := rbush.New(3)
	for i := 0; i < 7500; i++ {
		x := rand.Float64()*1 - 0.5
		y := rand.Float64()*1 - 0.5
		z := rand.Float64()*1 - 0.5
		tr.Insert(makePoint(x, y, z))
	}

	p := pinhole.New()
	tr.Traverse(func(min, max []float64, level int, item rbush.Item) bool {
		if level > 0 {
			// front
			p.DrawLine(min[0], min[1], min[2], max[0], min[1], min[2])
			p.DrawLine(max[0], min[1], min[2], max[0], max[1], min[2])
			p.DrawLine(max[0], max[1], min[2], min[0], max[1], min[2])
			p.DrawLine(min[0], max[1], min[2], min[0], min[1], min[2])
			// back
			p.DrawLine(min[0], min[1], max[2], max[0], min[1], max[2])
			p.DrawLine(max[0], min[1], max[2], max[0], max[1], max[2])
			p.DrawLine(max[0], max[1], max[2], min[0], max[1], max[2])
			p.DrawLine(min[0], max[1], max[2], min[0], min[1], max[2])
			// connectors
			p.DrawLine(min[0], min[1], min[2], min[0], min[1], max[2])
			p.DrawLine(max[0], min[1], min[2], max[0], min[1], max[2])
			p.DrawLine(max[0], max[1], min[2], max[0], max[1], max[2])
			p.DrawLine(min[0], max[1], min[2], min[0], max[1], max[2])
		}
		return true
	})
	opts := *pinhole.DefaultImageOptions
	opts.LineWidth = 0.05
	opts.NoCaps = true
	p.SavePNG("out3d.png", 500, 500, &opts)
}

func TestOutput2DPNG(t *testing.T) {
	rand.Seed(time.Now().UnixNano())
	tr := rbush.New(2)
	for i := 0; i < 7500; i++ {
		x := rand.Float64()*360 - 180
		y := rand.Float64()*180 - 90
		tr.Insert(makePoint(x, y))
	}

	var w, h float64
	var scale float64 = 3.0
	var dc *gg.Context
	tr.Traverse(func(min, max []float64, level int, item rbush.Item) bool {
		if dc == nil {
			w, h = (max[0]-min[0])*scale, (max[1]-min[1])*scale
			dc = gg.NewContext(int(w), int(h))
			dc.DrawRectangle(0, 0, w+1, h+1)
			dc.SetRGB(0, 0, 0)
			dc.Fill()
			dc.SetLineWidth(0.2 * scale)
		}
		switch level {
		default:
			dc.SetRGB(0, 0, 0)
		case 0:
			dc.SetRGB(1, 0, 0)
		case 1:
			dc.SetRGB(0, 1, 0)
		case 2:
			dc.SetRGB(0, 0, 1)
		case 3:
			dc.SetRGB(1, 1, 0)
		case 4:
			dc.SetRGB(1, 0, 1)
		case 5:
			dc.SetRGB(0, 1, 1)
		case 6:
			dc.SetRGB(0.5, 0, 0)
		case 7:
			dc.SetRGB(0, 0.5, 0)
		}
		if level == 0 {
			dc.DrawRectangle(min[0]*scale+w/2-1, min[1]*scale+h/2-1, (max[0]-min[0])*scale+1, (max[1]-min[1])*scale+1)
			dc.Fill()
		} else {
			dc.DrawRectangle(min[0]*scale+w/2, min[1]*scale+h/2, (max[0]-min[0])*scale, (max[1]-min[1])*scale)
			dc.Stroke()
		}
		return true
	})
	dc.SavePNG("out2d.png")
}
