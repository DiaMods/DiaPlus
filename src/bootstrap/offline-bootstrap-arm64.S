.text
.p2align 2

// Swift class allocating initializers keep the metatype in x20.  C cannot
// express that convention, so these two tiny adapters bridge from the normal
// arm64 C ABI without changing Dia's executable code.

.globl _dia_custom_call_prompt_tools_allocating_init
_dia_custom_call_prompt_tools_allocating_init:
    stp x20, x30, [sp, #-16]!
    mov x16, x0                 // initializer address
    mov x20, x1                 // PromptToolsController metadata
    mov x0, x2                  // &BrowserID
    mov x1, xzr                 // unused by this allocating thunk
    mov x2, x3                  // &DynamicDependencyPropagationToken
    blr x16
    ldp x20, x30, [sp], #16
    ret

.globl _dia_custom_call_platform_window_prompt_tools_presenter
_dia_custom_call_platform_window_prompt_tools_presenter:
    stp x20, x30, [sp, #-16]!
    mov x16, x0                 // presenter implementation address
    mov x20, x1                 // Window.PlatformWindow self
    mov x0, x2                  // PromptToolsController
    blr x16
    ldp x20, x30, [sp], #16
    ret
