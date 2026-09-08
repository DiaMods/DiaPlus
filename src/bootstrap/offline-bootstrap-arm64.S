.text
.p2align 2

// A discovered synchronous zero-argument Swift class method uses x20 for self.
.globl _dia_custom_call_swift_void_method
_dia_custom_call_swift_void_method:
    stp x20, x30, [sp, #-16]!
    mov x16, x0
    mov x20, x1
    blr x16
    ldp x20, x30, [sp], #16
    ret

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

// Combine's CurrentValueSubject.send(_:) uses Swift's self-in-x20 calling
// convention and receives the value indirectly in x0.  The Swift reflection
// shim supplies a value of the subject's exact private Output type.
.globl _dia_custom_call_current_value_subject_send
_dia_custom_call_current_value_subject_send:
    stp x20, x30, [sp, #-16]!
    mov x16, x0                 // CurrentValueSubject.send implementation
    mov x20, x1                 // CurrentValueSubject self
    mov x0, x2                  // pointer to Output value
    blr x16
    ldp x20, x30, [sp], #16
    ret
