# Third-party material

## Texas Instruments C2000Ware (BSD-3-Clause)

`src/sim/device/registers.json` and `src/sim/lib/ti_source.ts` are generated
from the F2837xD device-support headers and sources in C2000Ware 4.01
(`tools/gen-registers.mjs`, `tools/gen-ti-source.mjs`).

> Copyright (C) 2013-2022 Texas Instruments Incorporated - http://www.ti.com/
>
> Redistribution and use in source and binary forms, with or without
> modification, are permitted provided that the following conditions are met:
>
> Redistributions of source code must retain the above copyright notice, this
> list of conditions and the following disclaimer.
>
> Redistributions in binary form must reproduce the above copyright notice,
> this list of conditions and the following disclaimer in the documentation
> and/or other materials provided with the distribution.
>
> Neither the name of Texas Instruments Incorporated nor the names of its
> contributors may be used to endorse or promote products derived from this
> software without specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
> AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
> IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
> ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
> LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
> CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
> SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
> INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
> CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
> ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
> POSSIBILITY OF SUCH DAMAGE.

## SE 423 course serial library

The register setup in `src/sim/lib/prelude.ts` (`__init_sci`, the
`RXxINT_recv_ready` functions) follows `F28379dSerial.c` from the SE 423
course repository (University of Illinois). This repository is private
course material.

## Technical reference manual

Levels cite the TMS320F2837xD Technical Reference Manual (SPRUHM8I) by
section and page. The manual itself is not included; text is paraphrased.
