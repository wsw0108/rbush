package main

import "github.com/gopherjs/gopherjs/js"
import "github.com/tidwall/rbush"

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
		var tree = NewTree(js.Global.Get("document").Get("body"))
		cover := js.Global.Get("document").Call("createElement", "div")
		cover.Get("style").Set("height", "100%")
		cover.Get("style").Set("width", "100%")
		cover.Get("style").Set("background-image", "radial-gradient(ellipse farthest-corner at 45px 45px , #00FFFF 0%, rgba(0, 0, 255, 0) 50%, #0000FF 95%)")
		cover.Get("style").Set("opacity", "0.15")
		cover.Get("style").Set("position", "absolute")
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

}
