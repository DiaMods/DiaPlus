.text
.p2align 2
.globl _dia_custom_auth_client_local_qa
_dia_custom_auth_client_local_qa:
    stp x20, x19, [sp, #-0x20]!
    stp x29, x30, [sp, #0x10]
    add x29, sp, #0x10
    mov x19, x8
    // The two calls are encoded by patch-no-account.js because these absolute
    // Dia image addresses are not linkable symbols in this reference object.
    nop
    mov x1, x0
    mov x0, x19
    mov w2, #0x250
    nop
    // Preserve the already-proven local New Chat activation state even when
    // the synthetic UI-test user supplies the rest of AuthClient.
    adrp x8, 0
    add x8, x8, #0x48c
    stp x8, xzr, [x19, #0x60]
    stp x8, xzr, [x19, #0x80]
    stp x8, xzr, [x19, #0xb0]
    ldp x29, x30, [sp, #0x10]
    ldp x20, x19, [sp], #0x20
    ret
