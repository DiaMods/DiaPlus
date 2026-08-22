
work/Dia Custom RTTM.app/Contents/MacOS/Dia:	file format mach-o arm64

Disassembly of section __TEXT,__text:

0000000101b168f8 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE>:
1047da1bc: a9ba6ffc    	stp	x28, x27, [sp, #-0x60]!
1047da1c0: a90167fa    	stp	x26, x25, [sp, #0x10]
1047da1c4: a9025ff8    	stp	x24, x23, [sp, #0x20]
1047da1c8: a90357f6    	stp	x22, x21, [sp, #0x30]
1047da1cc: a9044ff4    	stp	x20, x19, [sp, #0x40]
1047da1d0: a9057bfd    	stp	x29, x30, [sp, #0x50]
1047da1d4: 910143fd    	add	x29, sp, #0x50
1047da1d8: d13a03ff    	sub	sp, sp, #0xe80
1047da1dc: aa1403f3    	mov	x19, x20
1047da1e0: aa0103f5    	mov	x21, x1
1047da1e4: aa0003f7    	mov	x23, x0
1047da1e8: 9115a3f6    	add	x22, sp, #0x568
1047da1ec: 910763fa    	add	x26, sp, #0x1d8
1047da1f0: f9400288    	ldr	x8, [x20]
1047da1f4: f90007e8    	str	x8, [sp, #0x8]
1047da1f8: f900269f    	str	xzr, [x20, #0x48]
1047da1fc: 91010280    	add	x0, x20, #0x40
1047da200: d2800001    	mov	x1, #0x0                ; =0
1047da204: 94368766    	bl	0x10557bf9c <_xmlXPathRegisterNs+0x10557bf9c>
1047da208: f000eff8    	adrp	x24, 0x1065d9000 <_xmlXPathRegisterNs+0x1065d9000>
1047da20c: f9449b18    	ldr	x24, [x24, #0x930]
1047da210: aa1803e0    	mov	x0, x24
1047da214: 97f16f4b    	bl	0x104435f40 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x291f648>
1047da218: f9002a80    	str	x0, [x20, #0x50]
1047da21c: aa1803e0    	mov	x0, x24
1047da220: 97f16fa9    	bl	0x1044360c4 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x291f7cc>
1047da224: f9002e80    	str	x0, [x20, #0x58]
1047da228: aa1803e0    	mov	x0, x24
1047da22c: 97f16fad    	bl	0x1044360e0 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x291f7e8>
1047da230: a9066280    	stp	x0, x24, [x20, #0x60]
1047da234: d2800000    	mov	x0, #0x0                ; =0
1047da238: 975a1451    	bl	0x101e5f37c <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x348a84>
1047da23c: 52803401    	mov	w1, #0x1a0              ; =416
1047da240: 528000e2    	mov	w2, #0x7                ; =7
1047da244: 94368585    	bl	0x10557b858 <_xmlXPathRegisterNs+0x10557b858>
1047da248: aa0003f4    	mov	x20, x0
1047da24c: 975a07e4    	bl	0x101e5c1dc <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x3458e4>
1047da250: f9003a60    	str	x0, [x19, #0x70]
1047da254: f000efe8    	adrp	x8, 0x1065d9000 <_xmlXPathRegisterNs+0x1065d9000>
1047da258: f944a108    	ldr	x8, [x8, #0x940]
1047da25c: a90a2268    	stp	x8, x8, [x19, #0xa0]
1047da260: d28ea868    	mov	x8, #0x7543             ; =30019
1047da264: f2ae8e68    	movk	x8, #0x7473, lsl #16
1047da268: f2cdade8    	movk	x8, #0x6d6f, lsl #32
1047da26c: d2fcc009    	mov	x9, #-0x1a00000000000000 ; =-1873497444986126336
1047da270: a90b2668    	stp	x8, x9, [x19, #0xb0]
1047da274: f00087c0    	adrp	x0, 0x1058d5000 <__ZN3mlx4core5uint8E+0x1ecb68>
1047da278: 91092000    	add	x0, x0, #0x248
1047da27c: 9436862e    	bl	0x10557bb34 <_xmlXPathRegisterNs+0x10557bb34>
1047da280: b000a079    	adrp	x25, 0x105be7000 <_xmlXPathRegisterNs+0x105be7000>
1047da284: 912c4339    	add	x25, x25, #0xb10
1047da288: b000a074    	adrp	x20, 0x105be7000 <_xmlXPathRegisterNs+0x105be7000>
1047da28c: 912e8294    	add	x20, x20, #0xba0
1047da290: 910763e8    	add	x8, sp, #0x1d8
1047da294: aa1903e1    	mov	x1, x25
1047da298: 52801142    	mov	w2, #0x8a               ; =138
1047da29c: 52800043    	mov	w3, #0x2                ; =2
1047da2a0: aa1403e4    	mov	x4, x20
1047da2a4: 52800585    	mov	w5, #0x2c               ; =44
1047da2a8: 52800046    	mov	w6, #0x2                ; =2
1047da2ac: 52800687    	mov	w7, #0x34               ; =52
1047da2b0: 96ea8075    	bl	0x10027a484 <__text+0x27723c>
1047da2b4: ad410740    	ldp	q0, q1, [x26, #0x20]
1047da2b8: ad070660    	stp	q0, q1, [x19, #0xe0]
1047da2bc: 3dc01340    	ldr	q0, [x26, #0x40]
1047da2c0: 3d804260    	str	q0, [x19, #0x100]
1047da2c4: ad400341    	ldp	q1, q0, [x26]
1047da2c8: ad060261    	stp	q1, q0, [x19, #0xc0]
1047da2cc: f00087c0    	adrp	x0, 0x1058d5000 <__ZN3mlx4core5uint8E+0x1ecb68>
1047da2d0: 9109e000    	add	x0, x0, #0x278
1047da2d4: 94368618    	bl	0x10557bb34 <_xmlXPathRegisterNs+0x10557bb34>
1047da2d8: f000f941    	adrp	x1, 0x106705000 <_xmlXPathRegisterNs+0x106705000>
1047da2dc: 91360021    	add	x1, x1, #0xd80
1047da2e0: 9706210b    	bl	0x10096270c <__text+0x95f4c4>
1047da2e4: a9110660    	stp	x0, x1, [x19, #0x110]
1047da2e8: f00087c0    	adrp	x0, 0x1058d5000 <__ZN3mlx4core5uint8E+0x1ecb68>
1047da2ec: 910aa000    	add	x0, x0, #0x2a8
1047da2f0: 94368611    	bl	0x10557bb34 <_xmlXPathRegisterNs+0x10557bb34>
1047da2f4: 9000f961    	adrp	x1, 0x106706000 <_xmlXPathRegisterNs+0x106706000>
1047da2f8: 912fe021    	add	x1, x1, #0xbf8
1047da2fc: 97062104    	bl	0x10096270c <__text+0x95f4c4>
1047da300: a9120660    	stp	x0, x1, [x19, #0x120]
1047da304: f00087c0    	adrp	x0, 0x1058d5000 <__ZN3mlx4core5uint8E+0x1ecb68>
1047da308: 910b6000    	add	x0, x0, #0x2d8
1047da30c: 9436860a    	bl	0x10557bb34 <_xmlXPathRegisterNs+0x10557bb34>
1047da310: d000f941    	adrp	x1, 0x106704000 <_xmlXPathRegisterNs+0x106704000>
1047da314: 9111e021    	add	x1, x1, #0x478
1047da318: 970620fd    	bl	0x10096270c <__text+0x95f4c4>
1047da31c: a9130660    	stp	x0, x1, [x19, #0x130]
1047da320: f00087c0    	adrp	x0, 0x1058d5000 <__ZN3mlx4core5uint8E+0x1ecb68>
1047da324: 910c2000    	add	x0, x0, #0x308
1047da328: 94368603    	bl	0x10557bb34 <_xmlXPathRegisterNs+0x10557bb34>
1047da32c: 9000ff21    	adrp	x1, 0x1067be000 <_xmlXPathRegisterNs+0x1067be000>
1047da330: 913b6021    	add	x1, x1, #0xed8
1047da334: 970620f6    	bl	0x10096270c <__text+0x95f4c4>
1047da338: a9140660    	stp	x0, x1, [x19, #0x140]
1047da33c: f00087c0    	adrp	x0, 0x1058d5000 <__ZN3mlx4core5uint8E+0x1ecb68>
1047da340: 910ce000    	add	x0, x0, #0x338
1047da344: 943685fc    	bl	0x10557bb34 <_xmlXPathRegisterNs+0x10557bb34>
1047da348: 9108a3e8    	add	x8, sp, #0x228
1047da34c: aa1903e1    	mov	x1, x25
1047da350: 52801142    	mov	w2, #0x8a               ; =138
1047da354: 52800043    	mov	w3, #0x2                ; =2
1047da358: aa1403e4    	mov	x4, x20
1047da35c: 52800585    	mov	w5, #0x2c               ; =44
1047da360: 52800046    	mov	w6, #0x2                ; =2
1047da364: 52800727    	mov	w7, #0x39               ; =57
1047da368: 96ea8047    	bl	0x10027a484 <__text+0x27723c>
1047da36c: ad438740    	ldp	q0, q1, [x26, #0x70]
1047da370: ad0b8660    	stp	q0, q1, [x19, #0x170]
1047da374: 3dc02740    	ldr	q0, [x26, #0x90]
1047da378: 3d806660    	str	q0, [x19, #0x190]
1047da37c: ad428341    	ldp	q1, q0, [x26, #0x50]
1047da380: ad0a8261    	stp	q1, q0, [x19, #0x150]
1047da384: f00087c0    	adrp	x0, 0x1058d5000 <__ZN3mlx4core5uint8E+0x1ecb68>
1047da388: 910da000    	add	x0, x0, #0x368
1047da38c: 943685ea    	bl	0x10557bb34 <_xmlXPathRegisterNs+0x10557bb34>
1047da390: 9109e3e8    	add	x8, sp, #0x278
1047da394: aa1903e1    	mov	x1, x25
1047da398: 52801142    	mov	w2, #0x8a               ; =138
1047da39c: 52800043    	mov	w3, #0x2                ; =2
1047da3a0: aa1403e4    	mov	x4, x20
1047da3a4: 52800585    	mov	w5, #0x2c               ; =44
1047da3a8: 52800046    	mov	w6, #0x2                ; =2
1047da3ac: 52800747    	mov	w7, #0x3a               ; =58
1047da3b0: 96ea8035    	bl	0x10027a484 <__text+0x27723c>
1047da3b4: ad460740    	ldp	q0, q1, [x26, #0xc0]
1047da3b8: ad0e0660    	stp	q0, q1, [x19, #0x1c0]
1047da3bc: 3dc03b40    	ldr	q0, [x26, #0xe0]
1047da3c0: 3d807a60    	str	q0, [x19, #0x1e0]
1047da3c4: ad450341    	ldp	q1, q0, [x26, #0xa0]
1047da3c8: ad0d0261    	stp	q1, q0, [x19, #0x1a0]
1047da3cc: f00087c0    	adrp	x0, 0x1058d5000 <__ZN3mlx4core5uint8E+0x1ecb68>
1047da3d0: 910e6000    	add	x0, x0, #0x398
1047da3d4: 943685d8    	bl	0x10557bb34 <_xmlXPathRegisterNs+0x10557bb34>
1047da3d8: 910b23e8    	add	x8, sp, #0x2c8
1047da3dc: aa1903e1    	mov	x1, x25
1047da3e0: 52801142    	mov	w2, #0x8a               ; =138
1047da3e4: 52800043    	mov	w3, #0x2                ; =2
1047da3e8: aa1403e4    	mov	x4, x20
1047da3ec: 52800585    	mov	w5, #0x2c               ; =44
1047da3f0: 52800046    	mov	w6, #0x2                ; =2
1047da3f4: 52800767    	mov	w7, #0x3b               ; =59
1047da3f8: 96ea8023    	bl	0x10027a484 <__text+0x27723c>
1047da3fc: ad488740    	ldp	q0, q1, [x26, #0x110]
1047da400: ad108660    	stp	q0, q1, [x19, #0x210]
1047da404: 3dc04f40    	ldr	q0, [x26, #0x130]
1047da408: 3d808e60    	str	q0, [x19, #0x230]
1047da40c: ad478341    	ldp	q1, q0, [x26, #0xf0]
1047da410: ad0f8261    	stp	q1, q0, [x19, #0x1f0]
1047da414: f00087c0    	adrp	x0, 0x1058d5000 <__ZN3mlx4core5uint8E+0x1ecb68>
1047da418: 910f2000    	add	x0, x0, #0x3c8
1047da41c: 943685c6    	bl	0x10557bb34 <_xmlXPathRegisterNs+0x10557bb34>
1047da420: 910c63e8    	add	x8, sp, #0x318
1047da424: aa1903e1    	mov	x1, x25
1047da428: 52801142    	mov	w2, #0x8a               ; =138
1047da42c: 52800043    	mov	w3, #0x2                ; =2
1047da430: aa1403e4    	mov	x4, x20
1047da434: 52800585    	mov	w5, #0x2c               ; =44
1047da438: 52800046    	mov	w6, #0x2                ; =2
1047da43c: 52800787    	mov	w7, #0x3c               ; =60
1047da440: 96ea8011    	bl	0x10027a484 <__text+0x27723c>
1047da444: ad4b0740    	ldp	q0, q1, [x26, #0x160]
1047da448: ad130660    	stp	q0, q1, [x19, #0x260]
1047da44c: 3dc06340    	ldr	q0, [x26, #0x180]
1047da450: 3d80a260    	str	q0, [x19, #0x280]
1047da454: ad4a0341    	ldp	q1, q0, [x26, #0x140]
1047da458: ad120261    	stp	q1, q0, [x19, #0x240]
1047da45c: f00087c0    	adrp	x0, 0x1058d5000 <__ZN3mlx4core5uint8E+0x1ecb68>
1047da460: 910fe000    	add	x0, x0, #0x3f8
1047da464: 943685b4    	bl	0x10557bb34 <_xmlXPathRegisterNs+0x10557bb34>
1047da468: 910da3e8    	add	x8, sp, #0x368
1047da46c: aa1903e1    	mov	x1, x25
1047da470: 52801142    	mov	w2, #0x8a               ; =138
1047da474: 52800043    	mov	w3, #0x2                ; =2
1047da478: aa1403e4    	mov	x4, x20
1047da47c: 52800585    	mov	w5, #0x2c               ; =44
1047da480: 52800046    	mov	w6, #0x2                ; =2
1047da484: 528007a7    	mov	w7, #0x3d               ; =61
1047da488: 96ea7fff    	bl	0x10027a484 <__text+0x27723c>
1047da48c: ad4d8740    	ldp	q0, q1, [x26, #0x1b0]
1047da490: ad158660    	stp	q0, q1, [x19, #0x2b0]
1047da494: 3dc07740    	ldr	q0, [x26, #0x1d0]
1047da498: 3d80b660    	str	q0, [x19, #0x2d0]
1047da49c: ad4c8341    	ldp	q1, q0, [x26, #0x190]
1047da4a0: ad148261    	stp	q1, q0, [x19, #0x290]
1047da4a4: 3dc002e0    	ldr	q0, [x23]
1047da4a8: 3d812be0    	str	q0, [sp, #0x4a0]
1047da4ac: 394042e8    	ldrb	w8, [x23, #0x10]
1047da4b0: 3912c3e8    	strb	w8, [sp, #0x4b0]
1047da4b4: 3cc182e1    	ldur	q1, [x23, #0x18]
1047da4b8: 3d8127e1    	str	q1, [sp, #0x490]
1047da4bc: 3dc006e1    	ldr	q1, [x23, #0x10]
1047da4c0: f94012e8    	ldr	x8, [x23, #0x20]
1047da4c4: f9004e68    	str	x8, [x19, #0x98]
1047da4c8: 3c888261    	stur	q1, [x19, #0x88]
1047da4cc: 3c878260    	stur	q0, [x19, #0x78]
1047da4d0: 911da3e0    	add	x0, sp, #0x768
1047da4d4: 9715a649    	bl	0x100d43df8 <__text+0xd40bb0>
1047da4d8: ad5482c1    	ldp	q1, q0, [x22, #0x290]
1047da4dc: 3d811740    	str	q0, [x26, #0x450]
1047da4e0: ad5502c2    	ldp	q2, q0, [x22, #0x2a0]
1047da4e4: 3d811b40    	str	q0, [x26, #0x460]
1047da4e8: ad5582c3    	ldp	q3, q0, [x22, #0x2b0]
1047da4ec: 3d811f40    	str	q0, [x26, #0x470]
1047da4f0: ad5282c4    	ldp	q4, q0, [x22, #0x250]
1047da4f4: 3d810740    	str	q0, [x26, #0x410]
1047da4f8: ad5302c5    	ldp	q5, q0, [x22, #0x260]
1047da4fc: 3d810b40    	str	q0, [x26, #0x420]
1047da500: ad5382c6    	ldp	q6, q0, [x22, #0x270]
1047da504: 3d810f40    	str	q0, [x26, #0x430]
1047da508: ad5402c7    	ldp	q7, q0, [x22, #0x280]
1047da50c: 3d811340    	str	q0, [x26, #0x440]
1047da510: ad5102d0    	ldp	q16, q0, [x22, #0x220]
1047da514: ad50c6d2    	ldp	q18, q17, [x22, #0x210]
1047da518: ad1e8351    	stp	q17, q0, [x26, #0x3d0]
1047da51c: ad5182d1    	ldp	q17, q0, [x22, #0x230]
1047da520: ad524ed4    	ldp	q20, q19, [x22, #0x240]
1047da524: ad1fcf40    	stp	q0, q19, [x26, #0x3f0]
1047da528: ad504ec0    	ldp	q0, q19, [x22, #0x200]
1047da52c: 3dc082d5    	ldr	q21, [x22, #0x200]
1047da530: ad1dcf40    	stp	q0, q19, [x26, #0x3b0]
1047da534: 9103e2c8    	add	x8, x22, #0xf8
1047da538: 3dc0b2c0    	ldr	q0, [x22, #0x2c0]
1047da53c: ad058103    	stp	q3, q0, [x8, #0xb0]
1047da540: ad039d06    	stp	q6, q7, [x8, #0x70]
1047da544: ad048901    	stp	q1, q2, [x8, #0x90]
1047da548: ad01d111    	stp	q17, q20, [x8, #0x30]
1047da54c: ad029504    	stp	q4, q5, [x8, #0x50]
1047da550: ad00c112    	stp	q18, q16, [x8, #0x10]
1047da554: f9441fe8    	ldr	x8, [sp, #0x838]
1047da558: f9441fe9    	ldr	x9, [sp, #0x838]
1047da55c: f9032fe8    	str	x8, [sp, #0x658]
1047da560: f9039be9    	str	x9, [sp, #0x730]
1047da564: 3c8f82d5    	stur	q21, [x22, #0xf8]
1047da568: f902b7f8    	str	x24, [sp, #0x568]
1047da56c: f902bbf8    	str	x24, [sp, #0x570]
1047da570: f902c3ff    	str	xzr, [sp, #0x580]
1047da574: f902bfff    	str	xzr, [sp, #0x578]
1047da578: f903a7ff    	str	xzr, [sp, #0x748]
1047da57c: f9039fff    	str	xzr, [sp, #0x738]
1047da580: f903a3ff    	str	xzr, [sp, #0x740]
1047da584: 790ea3ff    	strh	wzr, [sp, #0x750]
1047da588: f903b3ff    	str	xzr, [sp, #0x760]
1047da58c: f903afff    	str	xzr, [sp, #0x758]
1047da590: d2800000    	mov	x0, #0x0                ; =0
1047da594: 9400d215    	bl	0x10480ede8 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2cf84f0>
1047da598: 52805e21    	mov	w1, #0x2f1              ; =753
1047da59c: 528000e2    	mov	w2, #0x7                ; =7
1047da5a0: 943684ae    	bl	0x10557b858 <_xmlXPathRegisterNs+0x10557b858>
1047da5a4: aa0003f4    	mov	x20, x0
1047da5a8: 911283e0    	add	x0, sp, #0x4a0
1047da5ac: 913383e1    	add	x1, sp, #0xce0
1047da5b0: 97b8e9a6    	bl	0x103614c48 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x1afe350>
1047da5b4: 911243e0    	add	x0, sp, #0x490
1047da5b8: 913383e1    	add	x1, sp, #0xce0
1047da5bc: 975830d7    	bl	0x101de6918 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2d0020>
1047da5c0: 9115a3e0    	add	x0, sp, #0x568
1047da5c4: 9400d1a1    	bl	0x10480ec48 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2cf8350>
1047da5c8: f9001260    	str	x0, [x19, #0x20]
1047da5cc: 910ee3e8    	add	x8, sp, #0x3b8
1047da5d0: 97ffc152    	bl	0x1047cab18 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2cb4220>
1047da5d4: d2800000    	mov	x0, #0x0                ; =0
1047da5d8: 97ffa844    	bl	0x1047c46e8 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2caddf0>
1047da5dc: aa0003f8    	mov	x24, x0
1047da5e0: d0ffff59    	adrp	x25, 0x1047c4000 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2cad708>
1047da5e4: 911ba339    	add	x25, x25, #0x6e8
1047da5e8: 52801a21    	mov	w1, #0xd1               ; =209
1047da5ec: 528000e2    	mov	w2, #0x7                ; =7
1047da5f0: 9436849a    	bl	0x10557b858 <_xmlXPathRegisterNs+0x10557b858>
1047da5f4: aa0003f4    	mov	x20, x0
1047da5f8: 910ee3e0    	add	x0, sp, #0x3b8
1047da5fc: 97ffb911    	bl	0x1047c8a40 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2cb2148>
1047da600: f9001660    	str	x0, [x19, #0x28]
1047da604: d2800000    	mov	x0, #0x0                ; =0
1047da608: 97ff4395    	bl	0x1047ab45c <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2c94b64>
1047da60c: b9403001    	ldr	w1, [x0, #0x30]
1047da610: 79406802    	ldrh	w2, [x0, #0x34]
1047da614: 94368491    	bl	0x10557b858 <_xmlXPathRegisterNs+0x10557b858>
1047da618: aa0003f4    	mov	x20, x0
1047da61c: 97ff4070    	bl	0x1047aa7dc <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2c93ee4>
1047da620: f9001a60    	str	x0, [x19, #0x30]
1047da624: d2800000    	mov	x0, #0x0                ; =0
1047da628: 94001a8d    	bl	0x1047e105c <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2cca764>
1047da62c: b9403001    	ldr	w1, [x0, #0x30]
1047da630: 79406802    	ldrh	w2, [x0, #0x34]
1047da634: 94368489    	bl	0x10557b858 <_xmlXPathRegisterNs+0x10557b858>
1047da638: aa0003f4    	mov	x20, x0
1047da63c: f9000c1f    	str	xzr, [x0, #0x18]
1047da640: 91004000    	add	x0, x0, #0x10
1047da644: d2800001    	mov	x1, #0x0                ; =0
1047da648: 94368655    	bl	0x10557bf9c <_xmlXPathRegisterNs+0x10557bf9c>
1047da64c: f0012b08    	adrp	x8, 0x106d3d000 <__ZN3fmt3v1012format_facetINSt3__16localeEE2idE+0x1b96e8>
1047da650: f940e916    	ldr	x22, [x8, #0x1d0]
1047da654: 8b160280    	add	x0, x20, x22
1047da658: 913383e1    	add	x1, sp, #0xce0
1047da65c: 52800422    	mov	w2, #0x21               ; =33
1047da660: d2800003    	mov	x3, #0x0                ; =0
1047da664: 9436849e    	bl	0x10557b8dc <_xmlXPathRegisterNs+0x10557b8dc>
1047da668: 390053ff    	strb	wzr, [sp, #0x14]
1047da66c: b90013ff    	str	wzr, [sp, #0x10]
1047da670: 390067ff    	strb	wzr, [sp, #0x19]
1047da674: 52800068    	mov	w8, #0x3                ; =3
1047da678: b80153e8    	stur	w8, [sp, #0x15]
1047da67c: b0010481    	adrp	x1, 0x10686b000 <_xmlXPathRegisterNs+0x10686b000>
1047da680: 91230021    	add	x1, x1, #0x8c0
1047da684: 8b160288    	add	x8, x20, x22
1047da688: 910043e0    	add	x0, sp, #0x10
1047da68c: 94365b7e    	bl	0x105571484 <_xmlXPathRegisterNs+0x105571484>
1047da690: 913383e0    	add	x0, sp, #0xce0
1047da694: 943684f2    	bl	0x10557ba5c <_xmlXPathRegisterNs+0x10557ba5c>
1047da698: f9001e74    	str	x20, [x19, #0x38]
1047da69c: d2800000    	mov	x0, #0x0                ; =0
1047da6a0: 94000c75    	bl	0x1047dd874 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2cc6f7c>
1047da6a4: b9403001    	ldr	w1, [x0, #0x30]
1047da6a8: 79406802    	ldrh	w2, [x0, #0x34]
1047da6ac: 9436846b    	bl	0x10557b858 <_xmlXPathRegisterNs+0x10557b858>
1047da6b0: aa0003f4    	mov	x20, x0
1047da6b4: aa1703e0    	mov	x0, x23
1047da6b8: 94000bc5    	bl	0x1047dd5cc <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2cc6cd4>
1047da6bc: f9000e60    	str	x0, [x19, #0x18]
1047da6c0: 913383e1    	add	x1, sp, #0xce0
1047da6c4: aa1503e0    	mov	x0, x21
1047da6c8: 9755ec49    	bl	0x101d557ec <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x23eef4>
1047da6cc: 913383e0    	add	x0, sp, #0xce0
1047da6d0: 910043e1    	add	x1, sp, #0x10
1047da6d4: 9755ec46    	bl	0x101d557ec <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x23eef4>
1047da6d8: d2800000    	mov	x0, #0x0                ; =0
1047da6dc: 97062b7a    	bl	0x1009654c4 <__text+0x96227c>
1047da6e0: 52800521    	mov	w1, #0x29               ; =41
1047da6e4: 528000e2    	mov	w2, #0x7                ; =7
1047da6e8: 9436845c    	bl	0x10557b858 <_xmlXPathRegisterNs+0x10557b858>
1047da6ec: aa0003f4    	mov	x20, x0
1047da6f0: 910043e0    	add	x0, sp, #0x10
1047da6f4: 97062977    	bl	0x100964cd0 <__text+0x961a88>
1047da6f8: aa0003f4    	mov	x20, x0
1047da6fc: 913383e0    	add	x0, sp, #0xce0
1047da700: 9755ec4a    	bl	0x101d55828 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x23ef30>
1047da704: f9000a74    	str	x20, [x19, #0x10]
1047da708: f940167c    	ldr	x28, [x19, #0x28]
1047da70c: ad558660    	ldp	q0, q1, [x19, #0x2b0]
1047da710: 3d814fe0    	str	q0, [sp, #0x530]
1047da714: 3d8153e1    	str	q1, [sp, #0x540]
1047da718: 3dc0b660    	ldr	q0, [x19, #0x2d0]
1047da71c: 3d8157e0    	str	q0, [sp, #0x550]
1047da720: ad548261    	ldp	q1, q0, [x19, #0x290]
1047da724: 3d814be0    	str	q0, [sp, #0x520]
1047da728: 3d8147e1    	str	q1, [sp, #0x510]
1047da72c: aa1303e0    	mov	x0, x19
1047da730: 52800041    	mov	w1, #0x2                ; =2
1047da734: 943685a2    	bl	0x10557bdbc <_xmlXPathRegisterNs+0x10557bdbc>
1047da738: aa1c03e0    	mov	x0, x28
1047da73c: 9436859d    	bl	0x10557bdb0 <_xmlXPathRegisterNs+0x10557bdb0>
1047da740: d0012a97    	adrp	x23, 0x106d2c000 <__ZN3fmt3v1012format_facetINSt3__16localeEE2idE+0x1a86e8>
1047da744: 9104a2f7    	add	x23, x23, #0x128
1047da748: d000873a    	adrp	x26, 0x1058c0000 <__ZN3mlx4core5uint8E+0x1d7b68>
1047da74c: 9119035a    	add	x26, x26, #0x640
1047da750: 911443e0    	add	x0, sp, #0x510
1047da754: 913383e1    	add	x1, sp, #0xce0
1047da758: aa1703e2    	mov	x2, x23
1047da75c: aa1a03e3    	mov	x3, x26
1047da760: 96e0ad10    	bl	0x100005ba0 <__text+0x2958>
1047da764: aa1703e0    	mov	x0, x23
1047da768: aa1a03e1    	mov	x1, x26
1047da76c: 96e0a67b    	bl	0x100004158 <__text+0xf10>
1047da770: aa0003fb    	mov	x27, x0
1047da774: 913383e8    	add	x8, sp, #0xce0
1047da778: 911443f4    	add	x20, sp, #0x510
1047da77c: 96ea7fd5    	bl	0x10027a6d0 <__text+0x277488>
1047da780: 911443e0    	add	x0, sp, #0x510
1047da784: aa1703e1    	mov	x1, x23
1047da788: aa1a03e2    	mov	x2, x26
1047da78c: 96e0acec    	bl	0x100005b3c <__text+0x28f4>
1047da790: 912103e0    	add	x0, sp, #0x840
1047da794: 913383e1    	add	x1, sp, #0xce0
1047da798: 52802e02    	mov	w2, #0x170              ; =368
1047da79c: 94368204    	bl	0x10557afac <_xmlXPathRegisterNs+0x10557afac>
1047da7a0: f94423f6    	ldr	x22, [sp, #0x840]
1047da7a4: f94427f4    	ldr	x20, [sp, #0x848]
1047da7a8: aa1403e0    	mov	x0, x20
1047da7ac: 94368581    	bl	0x10557bdb0 <_xmlXPathRegisterNs+0x10557bdb0>
1047da7b0: 912103e0    	add	x0, sp, #0x840
1047da7b4: 96e0a515    	bl	0x100003c08 <__text+0x9c0>
1047da7b8: 528024a0    	mov	w0, #0x125              ; =293
1047da7bc: d63f02c0    	blr	x22
1047da7c0: aa0003f6    	mov	x22, x0
1047da7c4: aa1403e0    	mov	x0, x20
1047da7c8: 94368574    	bl	0x10557bd98 <_xmlXPathRegisterNs+0x10557bd98>
1047da7cc: f9406794    	ldr	x20, [x28, #0xc8]
1047da7d0: 913383e8    	add	x8, sp, #0xce0
1047da7d4: 94365ae4    	bl	0x105571364 <_xmlXPathRegisterNs+0x105571364>
1047da7d8: 3dc35be0    	ldr	q0, [sp, #0xd60]
1047da7dc: 3dc35fe1    	ldr	q1, [sp, #0xd70]
1047da7e0: 3d828fe0    	str	q0, [sp, #0xa30]
1047da7e4: 3d8293e1    	str	q1, [sp, #0xa40]
1047da7e8: 3dc363e0    	ldr	q0, [sp, #0xd80]
1047da7ec: 3d8297e0    	str	q0, [sp, #0xa50]
1047da7f0: 3dc34be0    	ldr	q0, [sp, #0xd20]
1047da7f4: 3dc34fe1    	ldr	q1, [sp, #0xd30]
1047da7f8: 3d827fe0    	str	q0, [sp, #0x9f0]
1047da7fc: 3d8283e1    	str	q1, [sp, #0xa00]
1047da800: 3dc357e0    	ldr	q0, [sp, #0xd50]
1047da804: 3dc353e1    	ldr	q1, [sp, #0xd40]
1047da808: 3d828be0    	str	q0, [sp, #0xa20]
1047da80c: 3d8287e1    	str	q1, [sp, #0xa10]
1047da810: 3dc33be0    	ldr	q0, [sp, #0xce0]
1047da814: 3dc33fe1    	ldr	q1, [sp, #0xcf0]
1047da818: 3d826fe0    	str	q0, [sp, #0x9b0]
1047da81c: 3d8273e1    	str	q1, [sp, #0x9c0]
1047da820: 3dc347e0    	ldr	q0, [sp, #0xd10]
1047da824: 3dc343e1    	ldr	q1, [sp, #0xd00]
1047da828: 3d827be0    	str	q0, [sp, #0x9e0]
1047da82c: 3d8277e1    	str	q1, [sp, #0x9d0]
1047da830: 913383e8    	add	x8, sp, #0xce0
1047da834: 3ccc1100    	ldur	q0, [x8, #0xc1]
1047da838: 3ccb1101    	ldur	q1, [x8, #0xb1]
1047da83c: ad0083e1    	stp	q1, q0, [sp, #0x10]
1047da840: 120002c8    	and	w8, w22, #0x1
1047da844: 392983e8    	strb	w8, [sp, #0xa60]
1047da848: 9126c3e8    	add	x8, sp, #0x9b0
1047da84c: 3c8b1101    	stur	q1, [x8, #0xb1]
1047da850: 3c8c1100    	stur	q0, [x8, #0xc1]
1047da854: f0012a80    	adrp	x0, 0x106d2d000 <__ZN3fmt3v1012format_facetINSt3__16localeEE2idE+0x1a96e8>
1047da858: 91368000    	add	x0, x0, #0xda0
1047da85c: d00087c2    	adrp	x2, 0x1058d4000 <__ZN3mlx4core5uint8E+0x1ebb68>
1047da860: 9114c042    	add	x2, x2, #0x530
1047da864: aa1903e1    	mov	x1, x25
1047da868: 96e14801    	bl	0x10002c86c <__text+0x29624>
1047da86c: aa0003f9    	mov	x25, x0
1047da870: aa1803e0    	mov	x0, x24
1047da874: aa1903e1    	mov	x1, x25
1047da878: aa1c03f4    	mov	x20, x28
1047da87c: 94365a96    	bl	0x1055712d4 <_xmlXPathRegisterNs+0x1055712d4>
1047da880: aa0003f4    	mov	x20, x0
1047da884: 94365ad0    	bl	0x1055713c4 <_xmlXPathRegisterNs+0x1055713c4>
1047da888: aa1403e0    	mov	x0, x20
1047da88c: 94368543    	bl	0x10557bd98 <_xmlXPathRegisterNs+0x10557bd98>
1047da890: f9406794    	ldr	x20, [x28, #0xc8]
1047da894: 3dc297e0    	ldr	q0, [sp, #0xa50]
1047da898: 3dc29be1    	ldr	q1, [sp, #0xa60]
1047da89c: 3d8363e0    	str	q0, [sp, #0xd80]
1047da8a0: 3d8367e1    	str	q1, [sp, #0xd90]
1047da8a4: 3dc29fe0    	ldr	q0, [sp, #0xa70]
1047da8a8: 3d836be0    	str	q0, [sp, #0xda0]
1047da8ac: 396a03e8    	ldrb	w8, [sp, #0xa80]
1047da8b0: 3936c3e8    	strb	w8, [sp, #0xdb0]
1047da8b4: 3dc287e0    	ldr	q0, [sp, #0xa10]
1047da8b8: 3dc28be1    	ldr	q1, [sp, #0xa20]
1047da8bc: 3d8353e0    	str	q0, [sp, #0xd40]
1047da8c0: 3d8357e1    	str	q1, [sp, #0xd50]
1047da8c4: 3dc28fe0    	ldr	q0, [sp, #0xa30]
1047da8c8: 3dc293e1    	ldr	q1, [sp, #0xa40]
1047da8cc: 3d835be0    	str	q0, [sp, #0xd60]
1047da8d0: 3d835fe1    	str	q1, [sp, #0xd70]
1047da8d4: 3dc277e0    	ldr	q0, [sp, #0x9d0]
1047da8d8: 3dc27be1    	ldr	q1, [sp, #0x9e0]
1047da8dc: 3d8343e0    	str	q0, [sp, #0xd00]
1047da8e0: 3d8347e1    	str	q1, [sp, #0xd10]
1047da8e4: 3dc27fe0    	ldr	q0, [sp, #0x9f0]
1047da8e8: 3dc283e1    	ldr	q1, [sp, #0xa00]
1047da8ec: 3d834be0    	str	q0, [sp, #0xd20]
1047da8f0: 3d834fe1    	str	q1, [sp, #0xd30]
1047da8f4: 3dc26fe0    	ldr	q0, [sp, #0x9b0]
1047da8f8: 3dc273e1    	ldr	q1, [sp, #0x9c0]
1047da8fc: 3d833be0    	str	q0, [sp, #0xce0]
1047da900: 3d833fe1    	str	q1, [sp, #0xcf0]
1047da904: 913383e0    	add	x0, sp, #0xce0
1047da908: 94365a91    	bl	0x10557134c <_xmlXPathRegisterNs+0x10557134c>
1047da90c: aa1c03e0    	mov	x0, x28
1047da910: 94368522    	bl	0x10557bd98 <_xmlXPathRegisterNs+0x10557bd98>
1047da914: 9126c3e0    	add	x0, sp, #0x9b0
1047da918: 97f5572d    	bl	0x1045305cc <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2a19cd4>
1047da91c: f940167c    	ldr	x28, [x19, #0x28]
1047da920: ad558660    	ldp	q0, q1, [x19, #0x2b0]
1047da924: 3d813be0    	str	q0, [sp, #0x4e0]
1047da928: 3d813fe1    	str	q1, [sp, #0x4f0]
1047da92c: 3dc0b660    	ldr	q0, [x19, #0x2d0]
1047da930: 3d8143e0    	str	q0, [sp, #0x500]
1047da934: ad548261    	ldp	q1, q0, [x19, #0x290]
1047da938: 3d8137e0    	str	q0, [sp, #0x4d0]
1047da93c: 3d8133e1    	str	q1, [sp, #0x4c0]
1047da940: aa1c03e0    	mov	x0, x28
1047da944: 9436851b    	bl	0x10557bdb0 <_xmlXPathRegisterNs+0x10557bdb0>
1047da948: 911303e0    	add	x0, sp, #0x4c0
1047da94c: 913383e1    	add	x1, sp, #0xce0
1047da950: aa1703e2    	mov	x2, x23
1047da954: aa1a03e3    	mov	x3, x26
1047da958: 96e0ac92    	bl	0x100005ba0 <__text+0x2958>
1047da95c: 913383e8    	add	x8, sp, #0xce0
1047da960: 911303f4    	add	x20, sp, #0x4c0
1047da964: aa1b03e0    	mov	x0, x27
1047da968: 96ea7f5a    	bl	0x10027a6d0 <__text+0x277488>
1047da96c: 911303e0    	add	x0, sp, #0x4c0
1047da970: aa1703e1    	mov	x1, x23
1047da974: aa1a03e2    	mov	x2, x26
1047da978: 96e0ac71    	bl	0x100005b3c <__text+0x28f4>
1047da97c: 912a43e0    	add	x0, sp, #0xa90
1047da980: 913383e1    	add	x1, sp, #0xce0
1047da984: 52802e02    	mov	w2, #0x170              ; =368
1047da988: 94368189    	bl	0x10557afac <_xmlXPathRegisterNs+0x10557afac>
1047da98c: f9454bf6    	ldr	x22, [sp, #0xa90]
1047da990: f9454ff4    	ldr	x20, [sp, #0xa98]
1047da994: aa1403e0    	mov	x0, x20
1047da998: 94368506    	bl	0x10557bdb0 <_xmlXPathRegisterNs+0x10557bdb0>
1047da99c: 912a43e0    	add	x0, sp, #0xa90
1047da9a0: 96e0a49a    	bl	0x100003c08 <__text+0x9c0>
1047da9a4: 528024c0    	mov	w0, #0x126              ; =294
1047da9a8: d63f02c0    	blr	x22
1047da9ac: aa0003f6    	mov	x22, x0
1047da9b0: aa1403e0    	mov	x0, x20
1047da9b4: 943684f9    	bl	0x10557bd98 <_xmlXPathRegisterNs+0x10557bd98>
1047da9b8: f9406794    	ldr	x20, [x28, #0xc8]
1047da9bc: 913383e8    	add	x8, sp, #0xce0
1047da9c0: 94365a69    	bl	0x105571364 <_xmlXPathRegisterNs+0x105571364>
1047da9c4: 3dc363e0    	ldr	q0, [sp, #0xd80]
1047da9c8: 3dc367e1    	ldr	q1, [sp, #0xd90]
1047da9cc: 3d832be0    	str	q0, [sp, #0xca0]
1047da9d0: 3d832fe1    	str	q1, [sp, #0xcb0]
1047da9d4: 3dc36be0    	ldr	q0, [sp, #0xda0]
1047da9d8: 3d8333e0    	str	q0, [sp, #0xcc0]
1047da9dc: 3dc353e0    	ldr	q0, [sp, #0xd40]
1047da9e0: 3dc357e1    	ldr	q1, [sp, #0xd50]
1047da9e4: 3d831be0    	str	q0, [sp, #0xc60]
1047da9e8: 3d831fe1    	str	q1, [sp, #0xc70]
1047da9ec: 3dc35fe0    	ldr	q0, [sp, #0xd70]
1047da9f0: 3dc35be1    	ldr	q1, [sp, #0xd60]
1047da9f4: 3d8327e0    	str	q0, [sp, #0xc90]
1047da9f8: 3d8323e1    	str	q1, [sp, #0xc80]
1047da9fc: 3dc343e0    	ldr	q0, [sp, #0xd00]
1047daa00: 3dc347e1    	ldr	q1, [sp, #0xd10]
1047daa04: 3d830be0    	str	q0, [sp, #0xc20]
1047daa08: 3d830fe1    	str	q1, [sp, #0xc30]
1047daa0c: 3dc34fe0    	ldr	q0, [sp, #0xd30]
1047daa10: 3dc34be1    	ldr	q1, [sp, #0xd20]
1047daa14: 3d8317e0    	str	q0, [sp, #0xc50]
1047daa18: 3d8313e1    	str	q1, [sp, #0xc40]
1047daa1c: 3dc33fe0    	ldr	q0, [sp, #0xcf0]
1047daa20: 3dc33be1    	ldr	q1, [sp, #0xce0]
1047daa24: 3d8307e0    	str	q0, [sp, #0xc10]
1047daa28: 3d8303e1    	str	q1, [sp, #0xc00]
1047daa2c: 120002c8    	and	w8, w22, #0x1
1047daa30: 393343e8    	strb	w8, [sp, #0xcd0]
1047daa34: aa1803e0    	mov	x0, x24
1047daa38: aa1903e1    	mov	x1, x25
1047daa3c: aa1c03f4    	mov	x20, x28
1047daa40: 94365a25    	bl	0x1055712d4 <_xmlXPathRegisterNs+0x1055712d4>
1047daa44: aa0003f4    	mov	x20, x0
1047daa48: 94365a5f    	bl	0x1055713c4 <_xmlXPathRegisterNs+0x1055713c4>
1047daa4c: aa1403e0    	mov	x0, x20
1047daa50: 943684d2    	bl	0x10557bd98 <_xmlXPathRegisterNs+0x10557bd98>
1047daa54: f9406794    	ldr	x20, [x28, #0xc8]
1047daa58: 3dc32be0    	ldr	q0, [sp, #0xca0]
1047daa5c: 3dc32fe1    	ldr	q1, [sp, #0xcb0]
1047daa60: 3d8363e0    	str	q0, [sp, #0xd80]
1047daa64: 3d8367e1    	str	q1, [sp, #0xd90]
1047daa68: 3dc333e0    	ldr	q0, [sp, #0xcc0]
1047daa6c: 3d836be0    	str	q0, [sp, #0xda0]
1047daa70: 397343e8    	ldrb	w8, [sp, #0xcd0]
1047daa74: 3936c3e8    	strb	w8, [sp, #0xdb0]
1047daa78: 3dc31be0    	ldr	q0, [sp, #0xc60]
1047daa7c: 3dc31fe1    	ldr	q1, [sp, #0xc70]
1047daa80: 3d8353e0    	str	q0, [sp, #0xd40]
1047daa84: 3d8357e1    	str	q1, [sp, #0xd50]
1047daa88: 3dc323e0    	ldr	q0, [sp, #0xc80]
1047daa8c: 3dc327e1    	ldr	q1, [sp, #0xc90]
1047daa90: 3d835be0    	str	q0, [sp, #0xd60]
1047daa94: 3d835fe1    	str	q1, [sp, #0xd70]
1047daa98: 3dc30be0    	ldr	q0, [sp, #0xc20]
1047daa9c: 3dc30fe1    	ldr	q1, [sp, #0xc30]
1047daaa0: 3d8343e0    	str	q0, [sp, #0xd00]
1047daaa4: 3d8347e1    	str	q1, [sp, #0xd10]
1047daaa8: 3dc313e0    	ldr	q0, [sp, #0xc40]
1047daaac: 3dc317e1    	ldr	q1, [sp, #0xc50]
1047daab0: 3d834be0    	str	q0, [sp, #0xd20]
1047daab4: 3d834fe1    	str	q1, [sp, #0xd30]
1047daab8: 3dc303e0    	ldr	q0, [sp, #0xc00]
1047daabc: 3dc307e1    	ldr	q1, [sp, #0xc10]
1047daac0: 3d833be0    	str	q0, [sp, #0xce0]
1047daac4: 3d833fe1    	str	q1, [sp, #0xcf0]
1047daac8: 913383e0    	add	x0, sp, #0xce0
1047daacc: 94365a20    	bl	0x10557134c <_xmlXPathRegisterNs+0x10557134c>
1047daad0: aa1c03e0    	mov	x0, x28
1047daad4: 943684b1    	bl	0x10557bd98 <_xmlXPathRegisterNs+0x10557bd98>
1047daad8: 913003e0    	add	x0, sp, #0xc00
1047daadc: 97f556bc    	bl	0x1045305cc <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2a19cd4>
1047daae0: f9400e68    	ldr	x8, [x19, #0x18]
1047daae4: f0012b09    	adrp	x9, 0x106d3d000 <__ZN3fmt3v1012format_facetINSt3__16localeEE2idE+0x1b96e8>
1047daae8: f9404929    	ldr	x9, [x9, #0x90]
1047daaec: 8b090100    	add	x0, x8, x9
1047daaf0: b0010488    	adrp	x8, 0x10686b000 <_xmlXPathRegisterNs+0x10686b000>
1047daaf4: 9112a108    	add	x8, x8, #0x4a8
1047daaf8: f9000408    	str	x8, [x0, #0x8]
1047daafc: aa1303e1    	mov	x1, x19
1047dab00: 9436851b    	bl	0x10557bf6c <_xmlXPathRegisterNs+0x10557bf6c>
1047dab04: f9401668    	ldr	x8, [x19, #0x28]
1047dab08: b0010489    	adrp	x9, 0x10686b000 <_xmlXPathRegisterNs+0x10686b000>
1047dab0c: 9114c129    	add	x9, x9, #0x530
1047dab10: f9000d09    	str	x9, [x8, #0x18]
1047dab14: 91004100    	add	x0, x8, #0x10
1047dab18: aa1303e1    	mov	x1, x19
1047dab1c: 94368514    	bl	0x10557bf6c <_xmlXPathRegisterNs+0x10557bf6c>
1047dab20: f9401a68    	ldr	x8, [x19, #0x30]
1047dab24: b0010489    	adrp	x9, 0x10686b000 <_xmlXPathRegisterNs+0x10686b000>
1047dab28: 91148129    	add	x9, x9, #0x520
1047dab2c: f9000d09    	str	x9, [x8, #0x18]
1047dab30: 91004100    	add	x0, x8, #0x10
1047dab34: aa1303e1    	mov	x1, x19
1047dab38: 9436850d    	bl	0x10557bf6c <_xmlXPathRegisterNs+0x10557bf6c>
1047dab3c: f9401e74    	ldr	x20, [x19, #0x38]
1047dab40: 91004280    	add	x0, x20, #0x10
1047dab44: 910703e1    	add	x1, sp, #0x1c0
1047dab48: 52800022    	mov	w2, #0x1                ; =1
1047dab4c: d2800003    	mov	x3, #0x0                ; =0
1047dab50: 94368363    	bl	0x10557b8dc <_xmlXPathRegisterNs+0x10557b8dc>
1047dab54: b0010488    	adrp	x8, 0x10686b000 <_xmlXPathRegisterNs+0x10686b000>
1047dab58: 91172108    	add	x8, x8, #0x5c8
1047dab5c: f9000e88    	str	x8, [x20, #0x18]
1047dab60: 91004280    	add	x0, x20, #0x10
1047dab64: aa1303e1    	mov	x1, x19
1047dab68: 94368501    	bl	0x10557bf6c <_xmlXPathRegisterNs+0x10557bf6c>
1047dab6c: aa1303e0    	mov	x0, x19
1047dab70: 9436848a    	bl	0x10557bd98 <_xmlXPathRegisterNs+0x10557bd98>
1047dab74: f00087c0    	adrp	x0, 0x1058d5000 <__ZN3mlx4core5uint8E+0x1ecb68>
1047dab78: 9110a000    	add	x0, x0, #0x428
1047dab7c: 943683ee    	bl	0x10557bb34 <_xmlXPathRegisterNs+0x10557bb34>
1047dab80: aa0003f7    	mov	x23, x0
1047dab84: d0ffeb68    	adrp	x8, 0x104548000 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2a31708>
1047dab88: 910cc108    	add	x8, x8, #0x330
1047dab8c: f90673e8    	str	x8, [sp, #0xce0]
1047dab90: f90677ff    	str	xzr, [sp, #0xce8]
1047dab94: 913383e0    	add	x0, sp, #0xce0
1047dab98: 9106a3e1    	add	x1, sp, #0x1a8
1047dab9c: 52800022    	mov	w2, #0x1                ; =1
1047daba0: d2800003    	mov	x3, #0x0                ; =0
1047daba4: 9436834e    	bl	0x10557b8dc <_xmlXPathRegisterNs+0x10557b8dc>
1047daba8: 90fdc228    	adrp	x8, 0x10001e000 <__text+0x1adb8>
1047dabac: 91312108    	add	x8, x8, #0xc48
1047dabb0: f90673e8    	str	x8, [sp, #0xce0]
1047dabb4: f90677ff    	str	xzr, [sp, #0xce8]
1047dabb8: b0fdc228    	adrp	x8, 0x10001f000 <__text+0x1bdb8>
1047dabbc: 91061108    	add	x8, x8, #0x184
1047dabc0: f9067be8    	str	x8, [sp, #0xcf0]
1047dabc4: f9067fff    	str	xzr, [sp, #0xcf8]
1047dabc8: b0fdc288    	adrp	x8, 0x10002b000 <__text+0x27db8>
1047dabcc: 91299108    	add	x8, x8, #0xa64
1047dabd0: f90683e8    	str	x8, [sp, #0xd00]
1047dabd4: f90687ff    	str	xzr, [sp, #0xd08]
1047dabd8: b0fdc288    	adrp	x8, 0x10002b000 <__text+0x27db8>
1047dabdc: 91299108    	add	x8, x8, #0xa64
1047dabe0: f9068be8    	str	x8, [sp, #0xd10]
1047dabe4: f9068fff    	str	xzr, [sp, #0xd18]
1047dabe8: 90fdc228    	adrp	x8, 0x10001e000 <__text+0x1adb8>
1047dabec: 91312108    	add	x8, x8, #0xc48
1047dabf0: f90693e8    	str	x8, [sp, #0xd20]
1047dabf4: f90697ff    	str	xzr, [sp, #0xd28]
1047dabf8: d0ffeb68    	adrp	x8, 0x104548000 <__ZN3mlx4core21deserialize_primitiveINS0_4fast25ScaledDotProductAttentionEEENSt3__110shared_ptrIT_EERNS0_2io18ParallelFileReaderENS0_6StreamE+0x2a31708>
1047dabfc: 910d3108    	add	x8, x8, #0x34c
1047dac00: f9069be8    	str	x8, [sp, #0xd30]
1047dac04: f9069fff    	str	xzr, [sp, #0xd38]
1047dac08: b0fdc288    	adrp	x8, 0x10002b000 <__text+0x27db8>
1047dac0c: 91299108    	add	x8, x8, #0xa64
1047dac10: f906a3e8    	str	x8, [sp, #0xd40]
1047dac14: f906a7ff    	str	xzr, [sp, #0xd48]
1047dac18: b0fdc288    	adrp	x8, 0x10002b000 <__text+0x27db8>
1047dac1c: 91299108    	add	x8, x8, #0xa64
1047dac20: f906abe8    	str	x8, [sp, #0xd50]
1047dac24: f906afff    	str	xzr, [sp, #0xd58]
1047dac28: 90fdc228    	adrp	x8, 0x10001e000 <__text+0x1adb8>
1047dac2c: 91312108    	add	x8, x8, #0xc48
1047dac30: f906b3e8    	str	x8, [sp, #0xd60]
1047dac34: f906b7ff    	str	xzr, [sp, #0xd68]
1047dac38: b0fdc288    	adrp	x8, 0x10002b000 <__text+0x27db8>
1047dac3c: 911c4108    	add	x8, x8, #0x710
1047dac40: f906bbe8    	str	x8, [sp, #0xd70]
1047dac44: f906bfff    	str	xzr, [sp, #0xd78]
1047dac48: 90fdc228    	adrp	x8, 0x10001e000 <__text+0x1adb8>
1047dac4c: 91312108    	add	x8, x8, #0xc48
1047dac50: f906c3e8    	str	x8, [sp, #0xd80]
1047dac54: f906c7ff    	str	xzr, [sp, #0xd88]
1047dac58: b0fdc288    	adrp	x8, 0x10002b000 <__text+0x27db8>
1047dac5c: 911c4108    	add	x8, x8, #0x710
1047dac60: f906cbe8    	str	x8, [sp, #0xd90]
1047dac64: f906cfff    	str	xzr, [sp, #0xd98]
1047dac68: b0fdc228    	adrp	x8, 0x10001f000 <__text+0x1bdb8>
1047dac6c: 91061108    	add	x8, x8, #0x184
1047dac70: f906d3e8    	str	x8, [sp, #0xda0]
1047dac74: f906d7ff    	str	xzr, [sp, #0xda8]
1047dac78: 90fdc228    	adrp	x8, 0x10001e000 <__text+0x1adb8>
1047dac7c: 91312108    	add	x8, x8, #0xc48
1047dac80: f906dbe8    	str	x8, [sp, #0xdb0]
1047dac84: f906dfff    	str	xzr, [sp, #0xdb8]
1047dac88: 90fde748    	adrp	x8, 0x1004c2000 <__text+0x4bedb8>
1047dac8c: 91294108    	add	x8, x8, #0xa50
1047dac90: f906e3e8    	str	x8, [sp, #0xdc0]
1047dac94: f906e7ff    	str	xzr, [sp, #0xdc8]
1047dac98: 90fdc228    	adrp	x8, 0x10001e000 <__text+0x1adb8>
1047dac9c: 91312108    	add	x8, x8, #0xc48
1047daca0: f906ebe8    	str	x8, [sp, #0xdd0]
1047daca4: f906efff    	str	xzr, [sp, #0xdd8]
1047daca8: 90fdc228    	adrp	x8, 0x10001e000 <__text+0x1adb8>
1047dacac: 91312108    	add	x8, x8, #0xc48
1047dacb0: f906f3e8    	str	x8, [sp, #0xde0]
1047dacb4: f906f7ff    	str	xzr, [sp, #0xde8]
1047dacb8: 90fdc228    	adrp	x8, 0x10001e000 <__text+0x1adb8>
1047dacbc: 91312108    	add	x8, x8, #0xc48
1047dacc0: f906fbe8    	str	x8, [sp, #0xdf0]
1047dacc4: f906ffff    	str	xzr, [sp, #0xdf8]
1047dacc8: 90fdc228    	adrp	x8, 0x10001e000 <__text+0x1adb8>
1047daccc: 91312108    	add	x8, x8, #0xc48
1047dacd0: f90703e8    	str	x8, [sp, #0xe00]
1047dacd4: f90707ff    	str	xzr, [sp, #0xe08]
1047dacd8: 90fdc228    	adrp	x8, 0x10001e000 <__text+0x1adb8>
1047dacdc: 91312108    	add	x8, x8, #0xc48
1047dace0: f9070be8    	str	x8, [sp, #0xe10]
1047dace4: f9070fff    	str	xzr, [sp, #0xe18]
1047dace8: 90fdc228    	adrp	x8, 0x10001e000 <__text+0x1adb8>
1047dacec: 91312108    	add	x8, x8, #0xc48
1047dacf0: f90713e8    	str	x8, [sp, #0xe20]
1047dacf4: f90717ff    	str	xzr, [sp, #0xe28]
1047dacf8: b0fdc268    	adrp	x8, 0x100027000 <__text+0x23db8>
1047dacfc: 91097108    	add	x8, x8, #0x25c
