package rbush

import (
	"crypto/md5"
	"fmt"
	"io/ioutil"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
)

const defaultMaxEntries = 9

type nodeT struct {
	minX, minY float64
	maxX, maxY float64
	children   []*nodeT
	height     int
	leaf       bool
}

type RBush struct {
	_maxEntries int
	_minEntries int
	data        *nodeT
}

type byMinX []*nodeT

func (arr byMinX) At(i int) interface{} {
	return arr[i]
}
func (arr byMinX) Compare(a, b interface{}) int {
	na, nb := a.(*nodeT), b.(*nodeT)
	if na.minX < nb.minX {
		return -1
	}
	if na.minX > nb.minX {
		return +1
	}
	return 0
}
func (arr byMinX) Less(i, j int) bool {
	return arr[i].minX < arr[j].minX
}

func (arr byMinX) Swap(i, j int) {
	arr[i], arr[j] = arr[j], arr[i]
}

func (arr byMinX) Len() int {
	return len(arr)
}

type byMinY []*nodeT

func (arr byMinY) At(i int) interface{} {
	return arr[i]
}
func (arr byMinY) Compare(a, b interface{}) int {
	na, nb := a.(*nodeT), b.(*nodeT)
	if na.minY < nb.minY {
		return -1
	}
	if na.minY > nb.minY {
		return +1
	}
	return 0
}
func (arr byMinY) Less(i, j int) bool {
	return arr[i].minY < arr[j].minY
}

func (arr byMinY) Swap(i, j int) {
	arr[i], arr[j] = arr[j], arr[i]
}

func (arr byMinY) Len() int {
	return len(arr)
}

func New(maxEntries int) *RBush {
	this := &RBush{}
	// max entries in a node is 9 by default; min node fill is 40% for best performance
	if maxEntries <= 0 {
		maxEntries = defaultMaxEntries
	}
	this._maxEntries = int(math.Max(4, float64(maxEntries)))
	this._minEntries = int(math.Max(2, math.Ceil(float64(this._maxEntries)*0.4)))
	this.clear()
	return this
}

func (this *RBush) all() []*nodeT {
	return this._all(this.data, nil)
}

func (this *RBush) search(bbox *nodeT) []*nodeT {
	var node = this.data
	var result []*nodeT
	if !intersects(bbox, node) {
		return result
	}
	var nodesToSearch []*nodeT
	for node != nil {
		for _, child := range node.children {
			if intersects(bbox, child) {
				if node.leaf {
					result = append(result, child)
				} else if contains(bbox, child) {
					result = this._all(child, result)
				} else {
					nodesToSearch = append(nodesToSearch, child)
				}
			}
		}
		if len(nodesToSearch) == 0 {
			node = nil
		} else {
			node = nodesToSearch[len(nodesToSearch)-1]
			nodesToSearch = nodesToSearch[:len(nodesToSearch)-1]
		}
	}
	return result
}

func (this *RBush) collides(bbox *nodeT) bool {
	node := this.data
	if !intersects(bbox, node) {
		return false
	}
	var nodesToSearch []*nodeT
	var i int
	var len_ int
	var child *nodeT
	var childBBox *nodeT
	for node != nil {
		for i, len_ = 0, len(node.children); i < len_; i++ {
			child = node.children[i]
			childBBox = child
			if intersects(bbox, childBBox) {
				if node.leaf || contains(bbox, childBBox) {
					return true
				}
				nodesToSearch = append(nodesToSearch, child)
			}
		}
		if len(nodesToSearch) == 0 {
			node = nil
		} else {
			node = nodesToSearch[len(nodesToSearch)-1]
			nodesToSearch = nodesToSearch[:len(nodesToSearch)-1]
		}
	}
	return false
}

func (this *RBush) load(data []*nodeT) *RBush {
	if len(data) == 0 {
		return this
	}

	if len(data) < this._minEntries {
		for i, len_ := 0, len(data); i < len_; i++ {
			this.insert(data[i])
		}
		return this
	}
	// recursively build the tree with the given data from scratch using OMT algorithm
	var node = this._build(ncopy(data), 0, len(data)-1, 0)
	if len(this.data.children) == 0 {
		// save as is if tree is empty
		this.data = node
	} else if this.data.height == node.height {
		// split root if trees have the same height
		this._splitRoot(this.data, node)
	} else {
		if this.data.height < node.height {
			// swap trees if inserted one is bigger
			this.data, node = node, this.data
		}

		// insert the small tree into the large tree at appropriate level
		this._insert(node, this.data.height-node.height-1, true)
	}
	return this
}

func (this *RBush) insert(item *nodeT) *RBush {
	if item != nil {
		this._insert(item, this.data.height-1, false)
	}
	return this
}

func (this *RBush) clear() *RBush {
	this.data = createNode(nil)
	return this
}

func (this *RBush) remove(item *nodeT) *RBush {
	if item == nil {
		return this
	}

	var node = this.data
	var bbox *nodeT = item
	var path []*nodeT
	var indexes []int

	var i int
	var parent *nodeT
	var index int
	var goingUp bool

	for node != nil || len(path) != 0 {
		if node == nil {
			node = path[len(path)-1]
			path = path[:len(path)-1]
			if len(path) == 0 {
				parent = nil
			} else {
				parent = path[len(path)-1]
			}
			i = indexes[len(indexes)-1]
			indexes = indexes[:len(indexes)-1]
			goingUp = true
		}

		if node.leaf {
			index = findItem(item, node.children)
			if index != -1 {
				// item found, remove the item and condense tree upwards
				node.children, _ = splice(node.children, index, 1)
				path = append(path, node)
				this._condense(path)
				return this
			}
		}

		if !goingUp && !node.leaf && contains(node, bbox) { // go down
			path = append(path, node)
			indexes = append(indexes, i)
			i = 0
			parent = node
			node = node.children[0]
		} else if parent != nil { // go right
			i++
			if i == len(parent.children) {
				node = nil
			} else {
				node = parent.children[i]
			}
			goingUp = false
		} else {
			node = nil
		}
	}
	return this
}

// fromJSON really has nothing to do with JSON. It's just here because JS.
func (this *RBush) toJSON() *nodeT {
	return this.data
}

// fromJSON really has nothing to do with JSON. It's just here because JS.
func (this *RBush) fromJSON(data *nodeT) *RBush {
	this.data = data
	return this
}

func (this *RBush) _all(node *nodeT, result []*nodeT) []*nodeT {
	if node.leaf {
		return append(result, node.children...)
	}
	for i := len(node.children) - 1; i >= 0; i-- {
		result = this._all(node.children[i], result)
	}
	return result
}

func (this *RBush) _build(items []*nodeT, left, right, height int) *nodeT {
	var N = right - left + 1
	var M = this._maxEntries
	var node *nodeT
	if N <= M {
		// reached leaf level; return leaf
		node = createNode(ncopy(items[left : right+1]))
		calcBBox(node)
		return node
	}
	if height == 0 {
		// target height of the bulk-loaded tree
		height = int(math.Ceil(math.Log(float64(N)) / math.Log(float64(M))))
		// target number of root entries to maximize storage utilization
		M = int(math.Ceil(float64(N) / math.Pow(float64(M), float64(height)-1)))
	}
	node = createNode(nil)
	node.leaf = false
	node.height = height
	// split the items into M mostly square tiles
	var N2 = int(math.Ceil(float64(N) / float64(M)))
	var N1 = N2 * int(math.Ceil(math.Sqrt(float64(M))))
	var i, j, right2, right3 int
	multiSelect(byMinX(items), left, right, N1)
	for i = left; i <= right; i += N1 {
		right2 = int(math.Min(float64(i+N1-1), float64(right)))
		multiSelect(byMinY(items), i, right2, N2)
		for j = i; j <= right2; j += N2 {
			right3 = int(math.Min(float64(j+N2-1), float64(right2)))
			// pack each entry recursively
			child := this._build(items, j, right3, height-1)
			node.children = append(node.children, child)
		}
	}
	calcBBox(node)
	return node
}

func (this *RBush) _chooseSubtree(bbox *nodeT, node *nodeT, level int, path []*nodeT) (
	*nodeT, []*nodeT,
) {
	var targetNode *nodeT
	var area, enlargement, minArea, minEnlargement float64
	for {
		path = append(path, node)
		if node.leaf || len(path)-1 == level {
			break
		}
		minEnlargement = math.Inf(+1)
		minArea = minEnlargement
		for _, child := range node.children {
			area = bboxArea(child)
			enlargement = enlargedArea(bbox, child) - area
			if enlargement < minEnlargement {
				minEnlargement = enlargement
				if area < minArea {
					minArea = area
				}
				targetNode = child
			} else if enlargement == minEnlargement {
				if area < minArea {
					minArea = area
					targetNode = child
				}
			}
		}
		if targetNode != nil {
			node = targetNode
		} else if len(node.children) > 0 {
			node = node.children[0]
		} else {
			node = nil
		}
	}
	return node, path
}

func (this *RBush) _insert(item *nodeT, level int, isNode bool) {
	var bbox *nodeT = item
	var insertPath []*nodeT
	var node *nodeT
	node, insertPath = this._chooseSubtree(bbox, this.data, level, insertPath)
	node.children = append(node.children, item)
	extend(node, bbox)
	for level >= 0 {
		if len(insertPath[level].children) > this._maxEntries {
			insertPath = this._split(insertPath, level)
			level--
		} else {
			break
		}
	}
	this._adjustParentBBoxes(bbox, insertPath, level)
}

// split overflowed node into two
func (this *RBush) _split(insertPath []*nodeT, level int) []*nodeT {
	var node = insertPath[level]
	var M = len(node.children)
	var m = this._minEntries

	this._chooseSplitAxis(node, m, M)

	splitIndex := this._chooseSplitIndex(node, m, M)

	var spliced []*nodeT
	node.children, spliced = splice(node.children, splitIndex, len(node.children)-splitIndex)
	var newNode = createNode(spliced)
	newNode.height = node.height
	newNode.leaf = node.leaf

	calcBBox(node)
	calcBBox(newNode)

	if level != 0 {
		insertPath[level-1].children = append(ncopy(insertPath[level-1].children), newNode)
	} else {
		this._splitRoot(node, newNode)
	}
	return insertPath
}

func (this *RBush) _splitRoot(node *nodeT, newNode *nodeT) {
	this.data = createNode([]*nodeT{node, newNode})
	this.data.height = node.height + 1
	this.data.leaf = false
	calcBBox(this.data)
}

func (this *RBush) _chooseSplitIndex(node *nodeT, m, M int) int {
	var i int
	var bbox1, bbox2 *nodeT
	var overlap, area, minOverlap, minArea float64
	var index int

	minArea = math.Inf(+1)
	minOverlap = minArea

	for i = m; i <= M-m; i++ {
		bbox1 = distBBox(node, 0, i, nil)
		bbox2 = distBBox(node, i, M, nil)

		overlap = intersectionArea(bbox1, bbox2)
		area = bboxArea(bbox1) + bboxArea(bbox2)

		// choose distribution with minimum overlap
		if overlap < minOverlap {
			minOverlap = overlap
			index = i

			if area < minArea {
				minArea = area
			}
		} else if overlap == minOverlap {
			// otherwise choose distribution with minimum area
			if area < minArea {
				minArea = area
				index = i
			}
		}
	}
	return index
}

// sorts node children by the best axis for split
func (this *RBush) _chooseSplitAxis(node *nodeT, m, M int) {
	var xMargin = this._allDistMargin(node, m, M, 1)
	var yMargin = this._allDistMargin(node, m, M, 2)
	// if total distributions margin value is minimal for x, sort by minX,
	// otherwise it's already sorted by minY
	if xMargin < yMargin {
		sortData(node.children, 1)
	}
}

// total margin of all possible split distributions where each node is at least m full
func (this *RBush) _allDistMargin(node *nodeT, m, M int, dim int) float64 {
	sortData(node.children, dim)

	var leftBBox = distBBox(node, 0, m, nil)
	var rightBBox = distBBox(node, M-m, M, nil)
	var margin = bboxMargin(leftBBox) + bboxMargin(rightBBox)

	var i int
	var child *nodeT

	for i = m; i < M-m; i++ {
		child = node.children[i]
		extend(leftBBox, child)
		margin += bboxMargin(leftBBox)
	}

	for i = M - m - 1; i >= m; i-- {
		child = node.children[i]
		extend(rightBBox, child)
		margin += bboxMargin(rightBBox)
	}

	return margin
}

func (this *RBush) _adjustParentBBoxes(bbox *nodeT, path []*nodeT, level int) {
	// adjust bboxes along the given tree path
	for i := level; i >= 0; i-- {
		extend(path[i], bbox)
	}
}

func (this *RBush) _condense(path []*nodeT) {
	// go through the path, removing empty nodes and updating bboxes
	var siblings []*nodeT
	for i := len(path) - 1; i >= 0; i-- {
		if len(path[i].children) == 0 {
			if i > 0 {
				siblings = path[i-1].children
				index := -1
				for j := 0; j < len(siblings); j++ {
					if siblings[j] == path[i] {
						index = j
						break
					}
				}
				siblings, _ = splice(ncopy(siblings), index, 1)
				path[i-1].children = siblings
			} else {
				this.clear()
			}
		} else {
			calcBBox(path[i])
		}
	}
}

func findItem(item *nodeT, items []*nodeT) int {
	for i := 0; i < len(items); i++ {
		if items[i] == item {
			return i
		}
	}
	return -1
}

// calculate node's bbox from bboxes of its children
func calcBBox(node *nodeT) {
	distBBox(node, 0, len(node.children), node)
}

// min bounding rectangle of node children from k to p-1
func distBBox(node *nodeT, k, p int, destNode *nodeT) *nodeT {
	if destNode == nil {
		destNode = createNode(nil)
	} else {
		destNode.minX = math.Inf(+1)
		destNode.minY = math.Inf(+1)
		destNode.maxX = math.Inf(-1)
		destNode.maxY = math.Inf(-1)
	}
	var child *nodeT
	for i := k; i < p; i++ {
		child = node.children[i]
		extend(destNode, child)
	}
	return destNode
}

func extend(a *nodeT, b *nodeT) *nodeT {
	a.minX = math.Min(a.minX, b.minX)
	a.minY = math.Min(a.minY, b.minY)
	a.maxX = math.Max(a.maxX, b.maxX)
	a.maxY = math.Max(a.maxY, b.maxY)
	return a
}

func bboxArea(a *nodeT) float64 {
	return (a.maxX - a.minX) * (a.maxY - a.minY)
}

func bboxMargin(a *nodeT) float64 {
	return (a.maxX - a.minX) + (a.maxY - a.minY)
}

func enlargedArea(a, b *nodeT) float64 {
	return (math.Max(b.maxX, a.maxX) - math.Min(b.minX, a.minX)) *
		(math.Max(b.maxY, a.maxY) - math.Min(b.minY, a.minY))
}

func intersectionArea(a, b *nodeT) float64 {
	var minX = math.Max(a.minX, b.minX)
	var minY = math.Max(a.minY, b.minY)
	var maxX = math.Min(a.maxX, b.maxX)
	var maxY = math.Min(a.maxY, b.maxY)
	return math.Max(0, maxX-minX) * math.Max(0, maxY-minY)
}

func contains(a, b *nodeT) bool {
	return a.minX <= b.minX &&
		a.minY <= b.minY &&
		b.maxX <= a.maxX &&
		b.maxY <= a.maxY
}

func intersects(a, b *nodeT) bool {
	return b.minX <= a.maxX &&
		b.minY <= a.maxY &&
		b.maxX >= a.minX &&
		b.maxY >= a.minY
}

func createNode(children []*nodeT) *nodeT {
	return &nodeT{
		children: children,
		height:   1,
		leaf:     true,
		minX:     math.Inf(+1),
		minY:     math.Inf(+1),
		maxX:     math.Inf(-1),
		maxY:     math.Inf(-1),
	}
}

//// sort an array so that items come in groups of n unsorted items, with groups sorted between each other;
//// combines selection algorithm with binary divide & conquer approach
//
//function multiSelect(arr, left, right, n, compare) {
func multiSelect(arr quickSelectArr, left, right, n int) {
	////--tp("_multiSelect 1: %d,%d,%d", left, right, n)
	//    var stack = [left, right],
	var stack = []int{left, right}
	//        mid;
	var mid int
	//
	//    while (stack.length) {
	for len(stack) > 0 {
		//        right = stack.pop();
		right = stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		//        left = stack.pop();
		left = stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		//
		//        if (right - left <= n) continue;
		////--tp("_multiSelect 2: %d,%d,%d", len(stack), right, left)
		if right-left <= n {
			//tp("_multiSelect 3: %d", len(stack))
			continue
		}
		//
		//        mid = left + Math.ceil((right - left) / n / 2) * n;
		mid = left + int(math.Ceil(float64(right-left)/float64(n)/2))*n
		////-//---//--tp("_multiSelect 4: %d,%d", len(stack), mid)
		//        quickselect(arr, mid, left, right, compare);
		quickselect(arr, mid, left, right)

		//
		//        stack.push(left, mid, mid, right);
		stack = append(stack, left, mid, mid, right)
		//    }
	}
	//}
	if false {
		switch nodes := arr.(type) {
		case byMinX:
			for i := 0; i < len(nodes); i++ {
				//--tp("_multiSelect 5: %d: %s", i, nodeString(nodes[i]))
			}
		case byMinY:
			for i := 0; i < len(nodes); i++ {
				//--tp("_multiSelect 5: %d: %s", i, nodeString(nodes[i]))
			}
		}
	}
}

func splice(nodes []*nodeT, start, deleteCount int, args ...*nodeT) (
	result []*nodeT,
	deleted []*nodeT,
) {
	if start > len(nodes) {
		start = len(nodes)
	}
	if start+deleteCount > len(nodes) {
		deleteCount = len(nodes) - start
	}
	deleted = nodes[start : start+deleteCount]
	result = append(ncopy(nodes[:start]), args...)
	result = append(result, nodes[start+deleteCount:]...)
	return
}

func count(node *nodeT) int {
	if len(node.children) == 0 {
		return 1
	}
	var n int
	for i := 0; i < len(node.children); i++ {
		n += count(node.children[i])
	}
	return n
}
func nodeString(node *nodeT) string {
	if node == nil {
		return "<nil>"
	}
	sum := nodeSum(node)
	return fmt.Sprintf(`&{children:"%d:%d"`+
		` height:%v`+
		` leaf:%v`+
		` minX:%v`+
		` minY:%v`+
		` maxX:%v`+
		` maxY:%v`+
		`} (%v)`,
		len(node.children), count(node),
		node.height, node.leaf,
		node.minX, node.minY, node.maxX, node.maxY,
		sum[len(sum)-7:],
	)
}

func (this *RBush) jsonString() string {
	var b []byte
	b = append(b, `{`+
		`"maxEntries":`+strconv.FormatInt(int64(this._maxEntries), 10)+`,`+
		`"minEntries":`+strconv.FormatInt(int64(this._minEntries), 10)+`,`+
		`"data":`...)
	b = appendNodeJSON(b, this.data, 1)
	b = append(b, '}')
	return string(b)
}

func appendNodeJSON(b []byte, node *nodeT, depth int) []byte {
	if node == nil {
		return append(b, "null"...)
	}
	b = append(b, '{')
	if len(node.children) > 0 {
		b = append(b, `"children":[`...)
		for i, child := range node.children {
			if i > 0 {
				b = append(b, ',')
			}
			b = appendNodeJSON(b, child, depth+1)
		}
		b = append(b, ']', ',')
	}
	b = append(b, `"leaf":`...)
	if node.leaf {
		b = append(b, "true"...)
	} else {
		b = append(b, "false"...)
	}
	b = append(b, `,"height":`...)
	b = append(b, strconv.FormatInt(int64(node.height), 10)...)
	b = append(b, `,"minX":`...)
	b = append(b, strconv.FormatFloat(node.minX, 'f', -1, 64)...)
	b = append(b, `,"minY":`...)
	b = append(b, strconv.FormatFloat(node.minY, 'f', -1, 64)...)
	b = append(b, `,"maxX":`...)
	b = append(b, strconv.FormatFloat(node.maxX, 'f', -1, 64)...)
	b = append(b, `,"maxY":`...)
	b = append(b, strconv.FormatFloat(node.maxY, 'f', -1, 64)...)
	b = append(b, '}')
	return b
}
func nodeJSONString(n *nodeT) string {
	return string(appendNodeJSON([]byte(nil), n, 0))
}
func nodeSum(n *nodeT) string {
	return fmt.Sprintf("%x", md5.Sum([]byte(nodeJSONString(n))))
}
func ncopy(nodes []*nodeT) []*nodeT {
	return append([]*nodeT(nil), nodes...)
}

var tpon = false
var tpc int
var tpall string
var tpt int
var tlines []string
var tbad = false
var tbadcount = 0
var tbadidx = 0

func tpsum(s string) string {
	hex := fmt.Sprintf("%X", md5.Sum([]byte(s)))
	return hex[len(hex)-4:]
}
func tp(format string, args ...interface{}) {
	if !tpon {
		return
	}
	if tpt == 0 {
		fmt.Printf("\n")
	}
	if tpc == 0 {
		data, _ := ioutil.ReadFile("out.log")
		tlines = strings.Split(string(data), "\n")
	}
	s := fmt.Sprintf(format, args...)
	tpall += s
	s = fmt.Sprintf("%04d:%s %s", tpc, tpsum(tpall), s)
	if !tbad {
		if tlines[tpc] != s {
			fmt.Printf("\x1b[91m\x1b[1m✗ %s\x1b[0m\n", s)
			fmt.Printf("# %s\n", tlines[tpc])
			tbad = true
			tbadcount++
			tbadidx = tpc
		} else {
			fmt.Printf("\x1b[38;5;83m\x1b[1m✓ %s\x1b[0m\n", s)
		}
	} else {
		fmt.Printf("\x1b[91m\x1b[1m✗ %s\x1b[0m\n", s)
		//fmt.Printf("# %s\n", tlines[tpc])
		if tbadcount == 5 {
			os.Exit(0)
		}
		tbadcount++
	}
	tpc++
	tpt++
}
func tpn(format string, args ...interface{}) {
	if tpt == 0 {
		fmt.Printf("\n")
	}
	fmt.Printf("\x1b[92m\x1b[1m✓ %s\x1b[0m\n", fmt.Sprintf(format, args...))
	tpt++
}
func tpq(format string, args ...interface{}) {
	tpn(format, args...)
	return
	if tpt == 0 {
		fmt.Printf("\n")
	}
	fmt.Printf("\x1b[35m\x1b[1m✓ %s\x1b[0m\n", fmt.Sprintf(format, args...))
	tpt++
}

func tpm(format string, args ...interface{}) {
	if tpt == 0 {
		fmt.Printf("\n")
	}
	fmt.Printf("\x1b[34m\x1b[1m• %s\x1b[0m\n", fmt.Sprintf(format, args...))
	tpt++
}

type quickSelectArr interface {
	Swap(i, j int)
	Compare(a, b interface{}) int
	At(i int) interface{}
}

func quickselect(arr quickSelectArr, k, left, right int) {
	for right > left {
		if right-left > 600 {
			var n = right - left + 1
			var m = k - left + 1
			var z = math.Log(float64(n))
			var s = 0.5 * math.Exp(2*z/3)
			var tt = 1
			if m-n/2 < 0 {
				tt = -1
			}
			var sd = 0.5 * math.Sqrt(z*s*(float64(n)-s)/float64(n)) * float64(tt)
			var newLeft = int(math.Max(float64(left), math.Floor(float64(k)-float64(m)*s/float64(n)+sd)))
			var newRight = int(math.Min(float64(right), math.Floor(float64(k)+float64(n-m)*s/float64(n)+sd)))
			quickselect(arr, k, newLeft, newRight)
		}

		var t = arr.At(k)
		var i = left
		var j = right

		arr.Swap(left, k)
		if arr.Compare(arr.At(right), t) > 0 {
			arr.Swap(left, right)
		}

		for i < j {
			arr.Swap(i, j)
			i++
			j--
			for arr.Compare(arr.At(i), t) < 0 {
				i++
			}
			for arr.Compare(arr.At(j), t) > 0 {
				j--
			}
		}

		if arr.Compare(arr.At(left), t) == 0 {
			arr.Swap(left, j)
		} else {
			j++
			arr.Swap(j, right)
		}

		if j <= k {
			left = j + 1
		}
		if k <= j {
			right = j - 1
		}
	}
}
func sortData(nodes []*nodeT, dim int) {
	var data sort.Interface
	switch dim {
	case 1:
		data = byMinX(nodes)
	case 2:
		data = byMinY(nodes)
	}
	sort.Sort(data)
}
