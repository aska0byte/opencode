import { DropdownMenu } from "@kobalte/core/dropdown-menu"
import { ContextMenu } from "@kobalte/core/context-menu"
import { onCleanup, Show, splitProps, type Component, type ComponentProps, type JSX, type ParentProps } from "solid-js"
import "./menu-v2.css"

const ChevronRight: Component = () => (
  <svg
    data-slot="menu-v2-item-chevron"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path d="M6 4L10 8L6 12V4Z" fill="currentColor" />
  </svg>
)

const CheckMark: Component = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path
      d="M3.53564 8.17857L6.39279 11.75L12.4642 4.25"
      stroke="currentColor"
      stroke-width="1"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

function ItemBody(
  props: ParentProps<{
    shortcut?: JSX.Element | string
    badge?: JSX.Element | string
    trailing?: JSX.Element
  }>,
) {
  return (
    <>
      <span data-slot="menu-v2-item-content">{props.children}</span>
      <Show when={props.shortcut}>{(shortcut) => <span data-slot="menu-v2-item-shortcut">{shortcut()}</span>}</Show>
      <Show when={props.badge}>{(badge) => <span data-slot="menu-v2-item-badge">{badge()}</span>}</Show>
      {props.trailing}
    </>
  )
}

export interface MenuV2ItemProps extends ComponentProps<typeof DropdownMenu.Item> {
  shortcut?: JSX.Element | string
  badge?: JSX.Element | string
}

function MenuV2Item(props: ParentProps<MenuV2ItemProps>) {
  const [s, r] = splitProps(props, ["class", "classList", "children", "shortcut", "badge"])
  return (
    <DropdownMenu.Item {...r} data-component="menu-v2-item" classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}>
      <ItemBody shortcut={s.shortcut} badge={s.badge}>
        {s.children}
      </ItemBody>
    </DropdownMenu.Item>
  )
}

export interface MenuV2CheckboxItemProps extends ComponentProps<typeof DropdownMenu.CheckboxItem> {
  shortcut?: JSX.Element | string
  badge?: JSX.Element | string
}

function MenuV2CheckboxItem(props: ParentProps<MenuV2CheckboxItemProps>) {
  const [s, r] = splitProps(props, ["class", "classList", "children", "shortcut", "badge"])
  return (
    <DropdownMenu.CheckboxItem
      {...r}
      data-component="menu-v2-item"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    >
      <ItemBody
        shortcut={s.shortcut}
        badge={s.badge}
        trailing={
          <DropdownMenu.ItemIndicator data-slot="menu-v2-item-indicator" forceMount>
            <CheckMark />
          </DropdownMenu.ItemIndicator>
        }
      >
        {s.children}
      </ItemBody>
    </DropdownMenu.CheckboxItem>
  )
}

export interface MenuV2RadioItemProps extends ComponentProps<typeof DropdownMenu.RadioItem> {
  shortcut?: JSX.Element | string
  badge?: JSX.Element | string
}

function MenuV2RadioItem(props: ParentProps<MenuV2RadioItemProps>) {
  const [s, r] = splitProps(props, ["class", "classList", "children", "shortcut", "badge"])
  return (
    <DropdownMenu.RadioItem
      {...r}
      data-component="menu-v2-item"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    >
      <ItemBody
        shortcut={s.shortcut}
        badge={s.badge}
        trailing={
          <DropdownMenu.ItemIndicator data-slot="menu-v2-item-indicator" forceMount>
            <CheckMark />
          </DropdownMenu.ItemIndicator>
        }
      >
        {s.children}
      </ItemBody>
    </DropdownMenu.RadioItem>
  )
}

export interface MenuV2SubTriggerProps extends ComponentProps<typeof DropdownMenu.SubTrigger> {
  shortcut?: JSX.Element | string
  badge?: JSX.Element | string
}

function MenuV2SubTrigger(props: ParentProps<MenuV2SubTriggerProps>) {
  const [s, r] = splitProps(props, ["class", "classList", "children", "shortcut", "badge"])
  return (
    <DropdownMenu.SubTrigger
      {...r}
      data-component="menu-v2-item"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    >
      <ItemBody shortcut={s.shortcut} badge={s.badge} trailing={<ChevronRight />}>
        {s.children}
      </ItemBody>
    </DropdownMenu.SubTrigger>
  )
}

function MenuV2SubContent(props: ComponentProps<typeof DropdownMenu.SubContent>) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return (
    <DropdownMenu.SubContent
      {...r}
      data-component="menu-v2-content"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

function MenuV2GroupLabel(props: ComponentProps<typeof DropdownMenu.GroupLabel>) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return (
    <DropdownMenu.GroupLabel
      {...r}
      data-slot="menu-v2-group-label"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

function MenuV2Separator(props: ComponentProps<typeof DropdownMenu.Separator>) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return (
    <DropdownMenu.Separator
      {...r}
      data-slot="menu-v2-separator"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

function MenuV2Content(props: ComponentProps<typeof DropdownMenu.Content>) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return (
    <DropdownMenu.Content
      {...r}
      data-component="menu-v2-content"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

function MenuV2Root(props: ComponentProps<typeof DropdownMenu>) {
  return <DropdownMenu {...props} />
}

	const LONG_PRESS_MS = 500
	const LONG_PRESS_MOVE_PX = 10

	/** Primary-button hold → context menu (MenuV2 uses raw Kobalte, not ui ContextMenu). */
	function attachContextLongPress(el: HTMLElement) {
	  let timer: number | undefined
	  let startX = 0
	  let startY = 0
	  let fired = false
	  let activePointerId: number | undefined

	  const clearTimer = () => {
	    if (timer !== undefined) {
	      window.clearTimeout(timer)
	      timer = undefined
	    }
	  }

	  const openAt = (x: number, y: number) => {
	    fired = true
	    el.dispatchEvent(
	      new MouseEvent("contextmenu", {
	        bubbles: true,
	        cancelable: true,
	        clientX: x,
	        clientY: y,
	        button: 2,
	        buttons: 2,
	        view: window,
	      }),
	    )
	  }

	  const onPointerDown = (e: PointerEvent) => {
	    if (e.button !== 0) return
	    if (e.pointerType === "mouse" && e.ctrlKey) return
	    startX = e.clientX
	    startY = e.clientY
	    fired = false
	    activePointerId = e.pointerId
	    clearTimer()
	    timer = window.setTimeout(() => {
	      timer = undefined
	      openAt(startX, startY)
	    }, LONG_PRESS_MS)
	  }

	  const onPointerMove = (e: PointerEvent) => {
	    if (activePointerId !== e.pointerId) return
	    if (timer === undefined) return
	    if (Math.hypot(e.clientX - startX, e.clientY - startY) > LONG_PRESS_MOVE_PX) clearTimer()
	  }

	  const onPointerUp = (e: PointerEvent) => {
	    if (activePointerId !== e.pointerId) return
	    clearTimer()
	    activePointerId = undefined
	    if (!fired) return
	    e.preventDefault()
	    e.stopPropagation()
	  }

	  const onPointerCancel = (e: PointerEvent) => {
	    if (activePointerId !== undefined && activePointerId !== e.pointerId) return
	    clearTimer()
	    activePointerId = undefined
	    fired = false
	  }

	  const onClickCapture = (e: MouseEvent) => {
	    if (!fired) return
	    e.preventDefault()
	    e.stopPropagation()
	    e.stopImmediatePropagation()
	    fired = false
	  }

	  el.style.touchAction = el.style.touchAction || "manipulation"
	  el.addEventListener("pointerdown", onPointerDown)
	  el.addEventListener("pointermove", onPointerMove)
	  el.addEventListener("pointerup", onPointerUp)
	  el.addEventListener("pointercancel", onPointerCancel)
	  el.addEventListener("click", onClickCapture, true)

	  return () => {
	    clearTimer()
	    el.removeEventListener("pointerdown", onPointerDown)
	    el.removeEventListener("pointermove", onPointerMove)
	    el.removeEventListener("pointerup", onPointerUp)
	    el.removeEventListener("pointercancel", onPointerCancel)
	    el.removeEventListener("click", onClickCapture, true)
	  }
	}

	function MenuV2ContextTrigger(props: ParentProps<ComponentProps<typeof ContextMenu.Trigger>>) {
	  const [local, rest] = splitProps(props, ["class", "classList", "children"])
	  return (
	    <ContextMenu.Trigger
	      {...rest}
	      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
	      ref={(el) => {
	        if (!(el instanceof HTMLElement)) return
	        onCleanup(attachContextLongPress(el))
	        const userRef = (rest as { ref?: ((el: HTMLElement) => void) | HTMLElement }).ref
	        if (typeof userRef === "function") userRef(el)
	      }}
	    >
	      {local.children}
	    </ContextMenu.Trigger>
	  )
	}

function MenuV2ContextRoot(props: ComponentProps<typeof ContextMenu>) {
  return <ContextMenu {...props} />
}

function MenuV2ContextContent(props: ComponentProps<typeof ContextMenu.Content>) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return (
    <ContextMenu.Content
      {...r}
      data-component="menu-v2-content"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

const MenuV2Context = Object.assign(MenuV2ContextRoot, {
  Trigger: MenuV2ContextTrigger,
  Portal: ContextMenu.Portal,
  Content: MenuV2ContextContent,
})

export const MenuV2 = Object.assign(MenuV2Root, {
  Trigger: DropdownMenu.Trigger,
  Portal: DropdownMenu.Portal,
  Content: MenuV2Content,
  Item: MenuV2Item,
  CheckboxItem: MenuV2CheckboxItem,
  RadioGroup: DropdownMenu.RadioGroup,
  RadioItem: MenuV2RadioItem,
  Group: DropdownMenu.Group,
  GroupLabel: MenuV2GroupLabel,
  Separator: MenuV2Separator,
  Sub: DropdownMenu.Sub,
  SubTrigger: MenuV2SubTrigger,
  SubContent: MenuV2SubContent,
  Context: MenuV2Context,
})
