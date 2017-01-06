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

type Node struct {
	MinX, MinY float64
	MaxX, MaxY float64
	Children   []*Node
	Height     int
	Leaf       bool
	Item       interface{}
}

type RBush struct {
	MaxEntries int
	MinEntries int
	Data       *Node
}

type byMinX []*Node

func (arr byMinX) At(i int) interface{} {
	return arr[i]
}
func (arr byMinX) Compare(a, b interface{}) int {
	na, nb := a.(*Node), b.(*Node)
	if na.MinX < nb.MinX {
		return -1
	}
	if na.MinX > nb.MinX {
		return +1
	}
	return 0
}
func (arr byMinX) Less(i, j int) bool {
	return arr[i].MinX < arr[j].MinX
}

func (arr byMinX) Swap(i, j int) {
	arr[i], arr[j] = arr[j], arr[i]
}

func (arr byMinX) Len() int {
	return len(arr)
}

type byMinY []*Node

func (arr byMinY) At(i int) interface{} {
	return arr[i]
}
func (arr byMinY) Compare(a, b interface{}) int {
	na, nb := a.(*Node), b.(*Node)
	if na.MinY < nb.MinY {
		return -1
	}
	if na.MinY > nb.MinY {
		return +1
	}
	return 0
}
func (arr byMinY) Less(i, j int) bool {
	return arr[i].MinY < arr[j].MinY
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
	this.MaxEntries = int(math.Max(4, float64(maxEntries)))
	this.MinEntries = int(math.Max(2, math.Ceil(float64(this.MaxEntries)*0.4)))
	this.clear()
	return this
}

func (this *RBush) all() []*Node {
	return this._all(this.Data, nil)
}

func (this *RBush) search(bbox *Node) []*Node {
	var node = this.Data
	var result []*Node
	if !intersects(bbox, node) {
		return result
	}
	var nodesToSearch []*Node
	for node != nil {
		for _, child := range node.Children {
			if intersects(bbox, child) {
				if node.Leaf {
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

func (this *RBush) collides(bbox *Node) bool {
	node := this.Data
	if !intersects(bbox, node) {
		return false
	}
	var nodesToSearch []*Node
	var i int
	var len_ int
	var child *Node
	var childBBox *Node
	for node != nil {
		for i, len_ = 0, len(node.Children); i < len_; i++ {
			child = node.Children[i]
			childBBox = child
			if intersects(bbox, childBBox) {
				if node.Leaf || contains(bbox, childBBox) {
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
func (this *RBush) Load(data []*Node) {
	this.load(data)
}
func (this *RBush) load(data []*Node) *RBush {
	if len(data) == 0 {
		return this
	}

	data = ncopy(data) // shallow copy
	if len(data) < this.MinEntries {
		for i, len_ := 0, len(data); i < len_; i++ {
			this.insert(data[i])
		}
		return this
	}
	// recursively build the tree with the given data from scratch using OMT algorithm
	// -- ncopy var node = this._build(ncopy(data), 0, len(data)-1, 0)
	var node = this._build(data, 0, len(data)-1, 0)
	if len(this.Data.Children) == 0 {
		// save as is if tree is empty
		this.Data = node
	} else if this.Data.Height == node.Height {
		// split root if trees have the same height
		this._splitRoot(this.Data, node)
	} else {
		if this.Data.Height < node.Height {
			// swap trees if inserted one is bigger
			this.Data, node = node, this.Data
		}

		// insert the small tree into the large tree at appropriate level
		this._insert(node, this.Data.Height-node.Height-1, true)
	}
	return this
}

func (this *RBush) insert(item *Node) *RBush {
	if item != nil {
		this._insert(item, this.Data.Height-1, false)
	}
	return this
}

func (this *RBush) clear() *RBush {
	this.Data = createNode(nil)
	return this
}

func (this *RBush) remove(item *Node) *RBush {
	if item == nil {
		return this
	}

	var node = this.Data
	var bbox *Node = item
	var path []*Node
	var indexes []int

	var i int
	var parent *Node
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

		if node.Leaf {
			index = findItem(item, node.Children)
			if index != -1 {
				// item found, remove the item and condense tree upwards
				node.Children, _ = splice(node.Children, index, 1)
				path = append(path, node)
				this._condense(path)
				return this
			}
		}

		if !goingUp && !node.Leaf && contains(node, bbox) { // go down
			path = append(path, node)
			indexes = append(indexes, i)
			i = 0
			parent = node
			node = node.Children[0]
		} else if parent != nil { // go right
			i++
			if i == len(parent.Children) {
				node = nil
			} else {
				node = parent.Children[i]
			}
			goingUp = false
		} else {
			node = nil
		}
	}
	return this
}

// fromJSON really has nothing to do with JSON. It's just here because JS.
func (this *RBush) toJSON() *Node {
	return this.Data
}

// fromJSON really has nothing to do with JSON. It's just here because JS.
func (this *RBush) fromJSON(data *Node) *RBush {
	this.Data = data
	return this
}

func (this *RBush) _all(node *Node, result []*Node) []*Node {
	if node.Leaf {
		return append(result, node.Children...)
	}
	for i := len(node.Children) - 1; i >= 0; i-- {
		result = this._all(node.Children[i], result)
	}
	return result
}

func (this *RBush) _build(items []*Node, left, right, height int) *Node {
	var N = right - left + 1
	var M = this.MaxEntries
	var node *Node
	if N <= M {
		// reached leaf level; return leaf
		//-- ncopy node = createNode(ncopy(items[left : right+1]))
		node = createNode(items[left : right+1])
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
	node.Leaf = false
	node.Height = height
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
			node.Children = append(node.Children, child)
		}
	}
	calcBBox(node)
	return node
}

func (this *RBush) _chooseSubtree(bbox *Node, node *Node, level int, path []*Node) (
	*Node, []*Node,
) {
	var targetNode *Node
	var area, enlargement, minArea, minEnlargement float64
	for {
		path = append(path, node)
		if node.Leaf || len(path)-1 == level {
			break
		}
		minEnlargement = math.Inf(+1)
		minArea = minEnlargement
		for _, child := range node.Children {
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
		} else if len(node.Children) > 0 {
			node = node.Children[0]
		} else {
			node = nil
		}
	}
	return node, path
}

func (this *RBush) _insert(item *Node, level int, isNode bool) {
	var bbox *Node = item
	var insertPath []*Node
	var node *Node
	node, insertPath = this._chooseSubtree(bbox, this.Data, level, insertPath)
	node.Children = append(node.Children, item)
	extend(node, bbox)
	for level >= 0 {
		if len(insertPath[level].Children) > this.MaxEntries {
			insertPath = this._split(insertPath, level)
			level--
		} else {
			break
		}
	}
	this._adjustParentBBoxes(bbox, insertPath, level)
}

// split overflowed node into two
func (this *RBush) _split(insertPath []*Node, level int) []*Node {
	var node = insertPath[level]
	var M = len(node.Children)
	var m = this.MinEntries

	this._chooseSplitAxis(node, m, M)

	splitIndex := this._chooseSplitIndex(node, m, M)

	var spliced []*Node
	node.Children, spliced = splice(node.Children, splitIndex, len(node.Children)-splitIndex)
	var newNode = createNode(spliced)
	newNode.Height = node.Height
	newNode.Leaf = node.Leaf

	calcBBox(node)
	calcBBox(newNode)

	if level != 0 {
		// -- ncopy removal insertPath[level-1].children = append(ncopy(insertPath[level-1].children), newNode)
		insertPath[level-1].Children = append(insertPath[level-1].Children, newNode)
	} else {
		this._splitRoot(node, newNode)
	}
	return insertPath
}

func (this *RBush) _splitRoot(node *Node, newNode *Node) {
	this.Data = createNode([]*Node{node, newNode})
	this.Data.Height = node.Height + 1
	this.Data.Leaf = false
	calcBBox(this.Data)
}

func (this *RBush) _chooseSplitIndex(node *Node, m, M int) int {
	var i int
	var bbox1, bbox2 *Node
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
func (this *RBush) _chooseSplitAxis(node *Node, m, M int) {
	var xMargin = this._allDistMargin(node, m, M, 1)
	var yMargin = this._allDistMargin(node, m, M, 2)
	// if total distributions margin value is minimal for x, sort by minX,
	// otherwise it's already sorted by minY
	if xMargin < yMargin {
		sortNodes(node.Children, 1)
	}
}

// total margin of all possible split distributions where each node is at least m full
func (this *RBush) _allDistMargin(node *Node, m, M int, dim int) float64 {
	sortNodes(node.Children, dim)
	var leftBBox = distBBox(node, 0, m, nil)
	var rightBBox = distBBox(node, M-m, M, nil)
	var margin = bboxMargin(leftBBox) + bboxMargin(rightBBox)

	var i int
	var child *Node

	for i = m; i < M-m; i++ {
		child = node.Children[i]
		extend(leftBBox, child)
		margin += bboxMargin(leftBBox)
	}

	for i = M - m - 1; i >= m; i-- {
		child = node.Children[i]
		extend(rightBBox, child)
		margin += bboxMargin(rightBBox)
	}

	return margin
}

func (this *RBush) _adjustParentBBoxes(bbox *Node, path []*Node, level int) {
	// adjust bboxes along the given tree path
	for i := level; i >= 0; i-- {
		extend(path[i], bbox)
	}
}

func (this *RBush) _condense(path []*Node) {
	// go through the path, removing empty nodes and updating bboxes
	var siblings []*Node
	for i := len(path) - 1; i >= 0; i-- {
		if len(path[i].Children) == 0 {
			if i > 0 {
				siblings = path[i-1].Children
				index := -1
				for j := 0; j < len(siblings); j++ {
					if siblings[j] == path[i] {
						index = j
						break
					}
				}
				// -- ncopy siblings, _ = splice(ncopy(siblings), index, 1)
				siblings, _ = splice(siblings, index, 1)
				path[i-1].Children = siblings
			} else {
				this.clear()
			}
		} else {
			calcBBox(path[i])
		}
	}
}

func findItem(item *Node, items []*Node) int {
	for i := 0; i < len(items); i++ {
		if items[i] == item {
			return i
		}
	}
	return -1
}

// calculate node's bbox from bboxes of its children
func calcBBox(node *Node) {
	distBBox(node, 0, len(node.Children), node)
}

// min bounding rectangle of node children from k to p-1
func distBBox(node *Node, k, p int, destNode *Node) *Node {
	if destNode == nil {
		destNode = createNode(nil)
	}
	destNode.MinX = math.Inf(+1)
	destNode.MinY = math.Inf(+1)
	destNode.MaxX = math.Inf(-1)
	destNode.MaxY = math.Inf(-1)

	var child *Node
	for i := k; i < p; i++ {
		child = node.Children[i]
		extend(destNode, child)
	}
	return destNode
}

func extend(a *Node, b *Node) *Node {
	a.MinX = math.Min(a.MinX, b.MinX)
	a.MinY = math.Min(a.MinY, b.MinY)
	a.MaxX = math.Max(a.MaxX, b.MaxX)
	a.MaxY = math.Max(a.MaxY, b.MaxY)
	return a
}

func bboxArea(a *Node) float64 {
	return (a.MaxX - a.MinX) * (a.MaxY - a.MinY)
}

func bboxMargin(a *Node) float64 {
	return (a.MaxX - a.MinX) + (a.MaxY - a.MinY)
}

func enlargedArea(a, b *Node) float64 {
	return (math.Max(b.MaxX, a.MaxX) - math.Min(b.MinX, a.MinX)) *
		(math.Max(b.MaxY, a.MaxY) - math.Min(b.MinY, a.MinY))
}

func intersectionArea(a, b *Node) float64 {
	var minX = math.Max(a.MinX, b.MinX)
	var minY = math.Max(a.MinY, b.MinY)
	var maxX = math.Min(a.MaxX, b.MaxX)
	var maxY = math.Min(a.MaxY, b.MaxY)
	return math.Max(0, maxX-minX) * math.Max(0, maxY-minY)
}

func contains(a, b *Node) bool {
	return a.MinX <= b.MinX &&
		a.MinY <= b.MinY &&
		b.MaxX <= a.MaxX &&
		b.MaxY <= a.MaxY
}

func intersects(a, b *Node) bool {
	return b.MinX <= a.MaxX &&
		b.MinY <= a.MaxY &&
		b.MaxX >= a.MinX &&
		b.MaxY >= a.MinY
}

func createNode(children []*Node) *Node {
	return &Node{
		Children: children,
		Height:   1,
		Leaf:     true,
		MinX:     math.Inf(+1),
		MinY:     math.Inf(+1),
		MaxX:     math.Inf(-1),
		MaxY:     math.Inf(-1),
	}
}

// sort an array so that items come in groups of n unsorted items, with groups sorted between each other;
// combines selection algorithm with binary divide & conquer approach
func multiSelect(arr quickSelectArr, left, right, n int) {
	var stack = []int{left, right}
	var mid int

	for len(stack) > 0 {
		right = stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		left = stack[len(stack)-1]
		stack = stack[:len(stack)-1]

		if right-left <= n {
			continue
		}

		mid = left + int(math.Ceil(float64(right-left)/float64(n)/2))*n
		quickselect(arr, mid, left, right)

		stack = append(stack, left, mid, mid, right)
	}
}

func splice(nodes []*Node, start, deleteCount int, args ...*Node) (
	result []*Node,
	deleted []*Node,
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

func count(node *Node) int {
	if len(node.Children) == 0 {
		return 1
	}
	var n int
	for i := 0; i < len(node.Children); i++ {
		n += count(node.Children[i])
	}
	return n
}
func nodeString(node *Node) string {
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
		len(node.Children), count(node),
		node.Height, node.Leaf,
		node.MinX, node.MinY, node.MaxX, node.MaxY,
		sum[len(sum)-7:],
	)
}

func (this *RBush) jsonString() string {
	var b []byte
	b = append(b, `{`+
		`"maxEntries":`+strconv.FormatInt(int64(this.MaxEntries), 10)+`,`+
		`"minEntries":`+strconv.FormatInt(int64(this.MinEntries), 10)+`,`+
		`"data":`...)
	b = appendNodeJSON(b, this.Data, 1)
	b = append(b, '}')
	return string(b)
}

func appendNodeJSON(b []byte, node *Node, depth int) []byte {
	if node == nil {
		return append(b, "null"...)
	}
	b = append(b, '{')
	if len(node.Children) > 0 {
		b = append(b, `"children":[`...)
		for i, child := range node.Children {
			if i > 0 {
				b = append(b, ',')
			}
			b = appendNodeJSON(b, child, depth+1)
		}
		b = append(b, ']', ',')
	}
	b = append(b, `"leaf":`...)
	if node.Leaf {
		b = append(b, "true"...)
	} else {
		b = append(b, "false"...)
	}
	b = append(b, `,"height":`...)
	b = append(b, strconv.FormatInt(int64(node.Height), 10)...)
	b = append(b, `,"minX":`...)
	b = append(b, strconv.FormatFloat(node.MinX, 'f', -1, 64)...)
	b = append(b, `,"minY":`...)
	b = append(b, strconv.FormatFloat(node.MinY, 'f', -1, 64)...)
	b = append(b, `,"maxX":`...)
	b = append(b, strconv.FormatFloat(node.MaxX, 'f', -1, 64)...)
	b = append(b, `,"maxY":`...)
	b = append(b, strconv.FormatFloat(node.MaxY, 'f', -1, 64)...)
	b = append(b, '}')
	return b
}
func nodeJSONString(n *Node) string {
	return string(appendNodeJSON([]byte(nil), n, 0))
}
func nodeSum(n *Node) string {
	return fmt.Sprintf("%x", md5.Sum([]byte(nodeJSONString(n))))
}
func ncopy(nodes []*Node) []*Node {
	return append([]*Node(nil), nodes...)
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

func sortNodes(nodes []*Node, dim int) {
	switch dim {
	default:
		panic("invalid dimension")
	case 1:
		sort.Sort(byMinX(nodes))
	case 2:
		sort.Sort(byMinY(nodes))
	}
}
