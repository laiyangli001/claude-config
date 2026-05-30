# H1 文档标题

## H2 章节标题

### H3 小节标题

#### H4 子节标题

##### H5 标题

###### H6 标题

---

## 正文排版

这是一段**正文**文字，包含 *斜体*、~~删除线~~、`行内代码` 以及 [超链接](https://example.com)。

这是一段很长的正文用来展示行高和段落间距。在真实的文档中，段落通常由多个句子组成，用来测试 CSS 的 line-height、margin 和 text-indent 等属性。

## 表格

| 名称 | 数量 | 单价 | 金额 | 备注 |
|------|------|------|------|------|
| 产品 A | 10 | 99.00 | 990.00 | 常规款 |
| 产品 B | 5 | 168.00 | 840.00 | 定制款 |
| 产品 C | 20 | 45.50 | 910.00 | 促销价 |
| **合计** | **35** | | **2740.00** | |

## 代码

行内代码：`console.log("hello world")`

### JavaScript

```javascript
function fibonacci(n) {
  const fib = [0, 1];
  for (let i = 2; i <= n; i++) {
    fib.push(fib[i - 1] + fib[i - 2]);
  }
  return fib;
}
console.log(fibonacci(10));
```

### Python

```python
class DataProcessor:
    def __init__(self, data: list):
        self.data = data
    def transform(self, multiplier: int = 2):
        return [x * multiplier for x in self.data if x > 0]
```

## 引用

> 这是一段引用文本。
>
> 多行引用用来测试引用块的样式。
>
> > 嵌套引用层级。

## 列表

### 无序列表

- 主要项目
  - 子项目 A
    - 子子项目
  - 子项目 B

### 有序列表

1. 第一步：安装依赖
2. 第二步：配置环境
   1. 调试模式
   2. 生产模式
3. 第三步：验证结果

## 公式

### 一元二次方程求根公式

$$ x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a} $$

### 泰勒级数展开

$$ e^x = \sum_{n=0}^{\infty} \frac{x^n}{n!} = 1 + x + \frac{x^2}{2!} + \frac{x^3}{3!} + \cdots $$

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

### 积分与极限

$$ \lim_{x \to 0} \frac{\sin x}{x} = 1 $$

$$ \int_{0}^{\infty} e^{-x^2} \, dx = \frac{\sqrt{\pi}}{2} $$

$$ \oint_C \mathbf{F} \cdot d\mathbf{r} = \iint_S (\nabla \times \mathbf{F}) \cdot d\mathbf{S} $$

### 求和与连乘

$$ \sum_{k=1}^{n} k^2 = \frac{n(n+1)(2n+1)}{6} $$

$$ \prod_{i=1}^{n} x_i = x_1 \cdot x_2 \cdot \cdots \cdot x_n $$

### 分段函数

$$
f(x) =
\begin{cases}
x^2, & x \geq 0 \\
-x, & x < 0
\end{cases}
$$

### 张量指标

$$ R_{\mu\nu} - \frac{1}{2}g_{\mu\nu}R + g_{\mu\nu}\Lambda = \frac{8\pi G}{c^4} T_{\mu\nu} $$

## 结语

以上就是用于 CSS 提取的完整示例文档。覆盖了文档生成中最常用的排版场景和复杂公式。
