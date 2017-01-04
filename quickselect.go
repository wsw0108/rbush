package rbush

import "math"

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
