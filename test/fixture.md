## Radar Waveforms (test fixture)

Range resolution ties to pulse duration $\tau$ and bandwidth $B$. Doppler shift is $f_d$.

### Key equations

The transmitted signal:

$$s(t) = A \operatorname{rect}\left(\frac{t}{\tau}\right) e^{j 2\pi f_0 t}$$

The rectangular function:

$$\operatorname{rect}\left(\frac{t}{\tau}\right) = \begin{cases} 1 & \text{if } \vert t \vert \le \frac{\tau}{2} \\ 0 & \text{otherwise} \end{cases}$$

Beat frequency (stretchy delimiters around a fraction):

$$f_b = \left\vert \frac{2 B R}{c T_c} \pm f_d \right\vert$$

Ambiguity integral with infinite limits:

$$\chi(\tau_d, f_d) = \int_{-\infty}^{\infty} u(t)\, u^*(t - \tau_d)\, e^{j 2\pi f_d t}\, dt$$

Phase-coded sum:

$$s(t) = A \sum_{n=0}^{N-1} \operatorname{rect}\left( \frac{t - n t_c}{t_c} \right) e^{j \phi_n}$$

- Chirp rate $K = \frac{B}{\tau}$ in $\text{Hz/s}$
- Normalization $\frac{1}{\sqrt{\tau}}$
- Range resolution $\Delta R = \frac{c}{2B}$

| Symbol | Meaning |
| --- | --- |
| $\tau$ | pulse duration |
| $B$ | bandwidth |
