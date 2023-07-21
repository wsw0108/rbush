package rbush

import (
	"github.com/tidwall/tinyqueue"
)

type queueItem struct {
	node   interface{}
	isItem bool
	dist   float64
}

func (item *queueItem) Less(b tinyqueue.Item) bool {
	return item.dist < b.(*queueItem).dist
}

func (tr *RBush) KNN(point []float64, iter func(item Item, dist float64) bool) bool {
	node := tr.Data
	queue := tinyqueue.New(nil)
	for node != nil {
		for _, child := range node.Children {
			var min, max []float64
			if node.Leaf {
				item := child.(Item)
				min, max = item.Rect()
			} else {
				node := child.(*TreeNode)
				min, max = node.Min, node.Max
			}
			queue.Push(&queueItem{
				node:   child,
				isItem: node.Leaf,
				dist:   boxDist(point, min, max),
			})
		}
		for queue.Len() > 0 && queue.Peek().(*queueItem).isItem {
			item := queue.Pop().(*queueItem)
			candidate := item.node
			if !iter(candidate.(Item), item.dist) {
				return false
			}
		}
		last := queue.Pop()
		if last != nil {
			node = last.(*queueItem).node.(*TreeNode)
		} else {
			node = nil
		}
	}
	return true
}

func boxDist(point []float64, min, max []float64) float64 {
	var dist float64
	for i := 0; i < len(point); i++ {
		d := axisDist(point[i], min[i], max[i])
		if i == 0 {
			dist = d * d
		} else {
			dist += d * d
		}
	}
	return dist
}

func axisDist(k, min, max float64) float64 {
	if k < min {
		return min - k
	}
	if k <= max {
		return 0
	}
	return k - max
}
