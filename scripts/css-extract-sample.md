# H1 文档标题

## H2 章节标题

### H3 小节标题

#### H4 子节标题

##### H5 标题

###### H6 标题

---

## 正文排版

这是一段**正文**文字，包含 *斜体*、~~删除线~~、`行内代码` 以及 [超链接](https://example.com)。

一段长文本用来测试 CSS 的行高和段落间距属性。

## 表格

| 名称 | 数量 | 单价 | 备注 |
|------|------|------|------|
| 产品 A | 10 | 99.00 | 常规 |
| 产品 B | 5 | 168.00 | 定制 |
| **合计** | **15** | | |

## 代码

行内：`console.log("hello")`

### JavaScript

```javascript
function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}
console.log(fib(10));
```

### Python

```python
def factorial(n):
    return 1 if n == 0 else n * factorial(n - 1)
```

## 引用

> 外层引用。
>
> > 嵌套引用。
> >
> > > 三层嵌套。

## 列表

- 主要项目
  - 子项目 A
    - 子子项目
  - 子项目 B

1. 第一步
2. 第二步
   1. 子步骤 A
   2. 子步骤 B
3. 第三步

---

## 公式

### 求根公式

$$ x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a} $$

### 矩阵乘法

$$
\begin{bmatrix}
a_{11} & a_{12} \\
a_{21} & a_{22}
\end{bmatrix}
\times
\begin{bmatrix}
b_{11} & b_{12} \\
b_{21} & b_{22}
\end{bmatrix}
=
\begin{bmatrix}
a_{11}b_{11} + a_{12}b_{21} & a_{11}b_{12} + a_{12}b_{22} \\
a_{21}b_{11} + a_{22}b_{21} & a_{21}b_{12} + a_{22}b_{22}
\end{bmatrix}
$$

### 极限

$$ \lim_{x \to 0} \frac{\sin x}{x} = 1 $$

### 积分

$$ \int_{0}^{\infty} e^{-x^2} \, dx = \frac{\sqrt{\pi}}{2} $$

### 分段函数

$$
f(x) =
\begin{cases}
x^2, & x \geq 0 \\
-x, & x < 0
\end{cases}
$$

### 求和与连乘

$$ \sum_{k=1}^{n} k^2 = \frac{n(n+1)(2n+1)}{6} $$

$$ \prod_{i=1}^{n} x_i = x_1 \cdot x_2 \cdot \cdots \cdot x_n $$

### 张量指标

$$ R_{\mu\nu} - \frac{1}{2}g_{\mu\nu}R + g_{\mu\nu}\Lambda = \frac{8\pi G}{c^4} T_{\mu\nu} $$

## 结语

以上就是 CSS 提取样本。覆盖了标题、正文、表格、代码、引用、列表、公式等常见排版元素。
