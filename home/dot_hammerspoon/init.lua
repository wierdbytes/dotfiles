hs.ipc.cliInstall("/opt/homebrew")

-- stackline = require("stackline")
-- stackline:init()
-- stackline.config:toggle("appearance.showIcons")

function dump(o)
	if type(o) == 'table' then
	   local s = '{ '
	   for k,v in pairs(o) do
		  if type(k) ~= 'number' then k = '"'..k..'"' end
		  s = s .. '['..k..'] = ' .. dump(v) .. ','
	   end
	   return s .. '} '
	else
	   return tostring(o)
	end
 end

-- Switch alacritty (from https://gist.github.com/truebit/31396bb2f48c75285d724c9e9e037bcd)
local spaces = require("hs.spaces") -- https://github.com/asmagill/hs._asm.spaces

local APP_NAME = "Ghostty"
local BUNDLE_ID = "com.mitchellh.ghostty"

FocusWatcher = hs.application.watcher.new(function(appName, eventType, appObject)
	if eventType == hs.application.watcher.deactivated and appName == APP_NAME then
		--print("appName= " .. appName  .. ", eventType= " .. eventType)
		appObject:hide()
	end
end)
--FocusWatcher:start()
local displayplacer_string =
	'/opt/homebrew/bin/displayplacer "id:37D8832A-2D66-02CA-B9F7-8F30A301B230 res:1440x900 hz:60 color_depth:8 enabled:true scaling:on origin:(0,0) degree:0" "id:17566138-FA72-9A50-0857-D6964E3302DB res:2560x1440 hz:60 color_depth:8 enabled:true scaling:off origin:(1440,-120) degree:0" "id:CCA8DAF4-3F65-3C57-C90B-A2661D91F570 res:1600x1200 hz:60 color_depth:4 enabled:true scaling:on origin:(1920,1320) degree:0"'
hs.execute(displayplacer_string)

zen = require("zen")

hs.hotkey.bind({ "cmd", "alt", "ctrl", "shift" }, "T", function()
	function moveWindow(termemu, space, mainScreen)
		-- move to main space
		local win = nil
		while win == nil do
			win = termemu:mainWindow()
		end
		if win:isFullScreen() then
			hs.eventtap.keyStroke("cmd", "return", 0, termemu)
		end
		winFrame = win:frame()
		scrFrame = mainScreen:fullFrame()
		-- winFrame.w = scrFrame.w - 68
		-- winFrame.h = scrFrame.h - 120
		winFrame.h = scrFrame.h - zen:bar_offset()
		-- winFrame.y = scrFrame.y + 60
		winFrame.y = scrFrame.y + zen:bar_offset()
		-- winFrame.x = scrFrame.x + 34
		winFrame.w = scrFrame.w
		-- winFrame.h = scrFrame.h
		-- winFrame.y = scrFrame.y
		winFrame.x = scrFrame.x
		win:setFrame(winFrame, 0)
		spaces.moveWindowToSpace(win, space)
		if win:isFullScreen() then
			hs.eventtap.keyStroke("cmd", "return", 0, termemu)
		end
		win:focus()
	end

	local terminal = hs.application.get(BUNDLE_ID)
	if terminal ~= nil and terminal:isFrontmost() then
		terminal:hide()
	else
		local space = spaces.activeSpaceOnScreen()
		local mainScreen = hs.screen.mainScreen()
		if terminal == nil and hs.application.launchOrFocusByBundleID(BUNDLE_ID) then
			local appWatcher = nil
			appWatcher = hs.application.watcher.new(function(name, event, app)
				if event == hs.application.watcher.launched and app:bundleID() == BUNDLE_ID then
					app:hide()
					moveWindow(app, space, mainScreen)
					appWatcher:stop()
				end
			end)
			appWatcher:start()
		end
		if terminal ~= nil then
			moveWindow(terminal, space, mainScreen)
		end
	end
end)

function move_window(monitor, x, y, width, height)
	--print("monitor: ", monitor, "x: ", x, "y: ", y, "width: ", width, "height: ", height)
	local win = hs.window.focusedWindow()
	local scr = hs.screen(monitor)
	local space = spaces.activeSpaceOnScreen(scr)
	local winFrame = win:frame()
	local scrFrame = scr:fullFrame()

    local bar_offset = barOffsetForScreen(scr)

	local percent_x = scrFrame.w / 100 * x
    local percent_y = (scrFrame.h + bar_offset) / 100 * y
	local percent_w = scrFrame.w * (width / 100) - percent_x
	local percent_h = (scrFrame.h + bar_offset) * (height / 100)
	winFrame.x = percent_x + scrFrame.x
    winFrame.y = percent_y + scrFrame.y + bar_offset
	winFrame.h = percent_h
	winFrame.w = percent_w
	win:moveToScreen(scr, true, false, 0)
	win:setFrame(winFrame, 0)
end

-- ====== helpers ======
local HYPER = { "cmd", "alt", "ctrl", "shift" }

-- forward declare event tap so functions can reference it
local tap = nil

-- zen bar offset should apply only on the Mi monitor (2560x1440)
local function isMiScreen(scr)
  if not scr then return false end
  local f = scr:frame()
  return f.w == 2560 and f.h == 1440
end

local function barOffsetForScreen(scr)
  if isMiScreen(scr) then
    return zen:bar_offset()
  else
    return 24
  end
end

local function focusedWindow()
  local win = hs.window.focusedWindow()
  if not win then hs.alert.show("No focused window"); end
  return win
end

-- percentage-based move, honoring your zen bar offset
local function moveWindowOnScreen(scr, xPct, yPct, rightEdgePct, hPct)
  local win = focusedWindow()
  if not win or not scr then return end

  local bar = barOffsetForScreen(scr)
  local scrFrame = scr:fullFrame()
  local winFrame = win:frame()

  local px = scrFrame.w * (xPct / 100)
  local py = (scrFrame.h - bar) * (yPct / 100)
  local w  = scrFrame.w * (rightEdgePct / 100) - px
  local h  = (scrFrame.h - bar) * (hPct / 100)
  
  winFrame.x = scrFrame.x + px
  winFrame.y = scrFrame.y + bar + py
  winFrame.w = w
  winFrame.h = h
  
  win:moveToScreen(scr, true, false, 0)
  win:setFrame(winFrame, 0)
end

-- ====== per-monitor profiles (match by resolution like in your setup) ======
-- Each profile defines: boundaries (percent marks), and the keys for each interval.
-- Intervals are between consecutive boundaries; keys map 1:1 to intervals.
local profiles = {
  builtin = {
    name = "builtin",
    match = function(scr) local f=scr:frame(); return f.w==1440 and f.h==900 end,
    boundaries = {0, 33.3333, 50, 66.6666, 100},
    keys = {"q","w","e","r"},
  },
  mi = {
    name = "mi",
    match = function(scr) local f=scr:frame(); return f.w==2560 and f.h==1440 end,
    boundaries = {0, 25, 33.3333, 50, 66.6666, 75, 100},
    keys = {"1","2","3","4","5","6"},
  },
  sidecar = {
    name = "sidecar",
    match = function(scr) local f=scr:frame(); return f.w==1600 and f.h==1200 end,
    boundaries = {0, 33.3333, 50, 66.6666, 100},
    keys = {"z","x","c","v"},
  },
}

-- Build a runtime map from key -> {screen, profile, intervalIndex}
local function buildKeyMap()
  local map = {}
  for _, scr in ipairs(hs.screen.allScreens()) do
    local prof = nil
    for _, p in pairs(profiles) do
      if p.match(scr) then prof = p; break end
    end
    -- If an unrecognized screen shows up, default to a generic 4-col grid with arrows (rare)
    if not prof then
      prof = { name="generic", boundaries={0, 25, 33.3333, 50, 66.6666, 75, 100}, keys={"`","a","s","d","f","g"} }
    end
    for i, key in ipairs(prof.keys) do
      map[key] = { screen = scr, profile = prof, intervalIndex = i }
    end
  end
  return map
end

-- ====== overlay drawing ======
local overlays = {}   -- uuid -> canvas

local function pctX(frame, p) return frame.x + frame.w * p / 100 end
local function pctY(frame, p) return frame.y + frame.h * p / 100 end

-- keycode reverse map so we can read keys even when modifiers (e.g. cmd) are held
local keycodeToName = {}
for name, code in pairs(hs.keycodes.map) do
  keycodeToName[code] = name
end

-- put this near the top with your helpers
local function makeCanvasClickThrough(cv)
	if type(cv.clickThrough) == "function" then
	  -- newer Hammerspoon
	  cv:clickThrough(true)
	elseif type(cv.clickActivating) == "function" then
	  -- older Hammerspoon: doesn't pass clicks through, but at least it
	  -- won’t activate Hammerspoon when you click the overlay
	  cv:clickActivating(false)
	end
  end  

local function makeOrShowOverlay(scr, prof, rowMode, selection)
  local uuid = scr:getUUID()
  local frame = scr:fullFrame()
  local bar = barOffsetForScreen(scr)
  local drawTop = bar
  local drawH = frame.h - bar
  local yStart = drawTop
  local yEnd = drawTop + drawH
  if rowMode == 2 then
    yStart = drawTop
    yEnd = drawTop + drawH/2
  elseif rowMode == 3 then
    yStart = drawTop + drawH/2
    yEnd = drawTop + drawH
  end

  local cv = overlays[uuid]
  if not cv then
    cv = hs.canvas.new(frame)
    cv:level(hs.canvas.windowLevels.overlay)
    cv:behavior(hs.canvas.windowBehaviors.canJoinAllSpaces)
    makeCanvasClickThrough(cv)
    overlays[uuid] = cv
  else
    -- Resize/reposition and clear existing elements. Some HS versions lack deleteElements.
    if type(cv.size) == "function" then cv:size({ w = frame.w, h = frame.h }) end
    if type(cv.topLeft) == "function" then cv:topLeft({ x = frame.x, y = frame.y }) end
    if type(cv.deleteElements) == "function" then
      cv:deleteElements()
    else
      -- Fallback: recreate the canvas to ensure a clean slate
      if type(cv.delete) == "function" then cv:delete() end
      cv = hs.canvas.new(frame)
      cv:level(hs.canvas.windowLevels.overlay)
      cv:behavior(hs.canvas.windowBehaviors.canJoinAllSpaces)
      makeCanvasClickThrough(cv)
      overlays[uuid] = cv
    end
  end

  -- dim background lightly
  cv[#cv+1] = {
    type="rectangle", action="fill",
    fillColor={alpha=0.50, red=0, green=0, blue=0},
    stroke=false
  }

  -- vertical grid lines (only across the active row region)
  local function isGreenPct(p)
    local function approx(a,b,eps) eps = eps or 0.2; return math.abs(a-b) < eps end
    return approx(p, 33.3333) or approx(p, 66.6666) or approx(p, 33.3) or approx(p, 66.6)
  end
  for i=2,#prof.boundaries-1 do
    local p = prof.boundaries[i]
    local x = pctX(frame, p) - frame.x
    local lineColor = isGreenPct(p)
      and { red=0.2, green=0.95, blue=0.3, alpha=0.95 }
      or  { red=0.1, green=0.5,  blue=1.0, alpha=0.9 }
    cv[#cv+1] = {
      type="segments",
      strokeWidth=2,
      strokeColor=lineColor,
      coordinates={ {x=x, y=yStart}, {x=x, y=yEnd} }
    }
  end

  -- no center line

  -- little labels: top % marks (optional, minimal), bottom key labels
  local font = { name="Menlo", size=14 }
  for i=2,#prof.boundaries-1 do
    local p = prof.boundaries[i]
    local x = pctX(frame, p) - frame.x
    cv[#cv+1] = {
      type="text", text=tostring(p),
      textColor={white=1, alpha=0.85}, textSize=14, withShadow=true,
      frame={ x=x-16, y=yStart + 6, w=32, h=18 },
      textFont=font
    }
  end

  for i,key in ipairs(prof.keys) do
    local left = prof.boundaries[i]
    local right = prof.boundaries[i+1]
    local cx = (pctX(frame, left) + pctX(frame, right))/2 - frame.x

    -- center Y depends on row mode
    local centerY = (yStart + yEnd) / 2

    local bgW, bgH = 48, 44
    local bgX, bgY = cx - (bgW / 2), centerY - (bgH / 2)

    -- dark background chip (only draw for active row region)
    cv[#cv+1] = {
      type = "rectangle", action = "fill",
      fillColor = { red=0, green=0, blue=0, alpha=0.7 },
      roundedRectRadii = { xRadius = 6, yRadius = 6 },
      frame = { x = bgX, y = bgY, w = bgW, h = bgH }
    }

    -- centered key text (2x bigger)
    cv[#cv+1] = {
      type = "text", text = key,
      textColor = { white = 1, alpha = 0.95 }, textSize = 32, withShadow = true,
      textAlignment = "center",
      frame = { x = bgX, y = bgY, w = bgW, h = bgH },
      textFont = font
    }
  end

  -- rowMode highlight bar
  if rowMode == 2 then
    cv[#cv+1] = { type="rectangle", action="stroke", strokeWidth=3,
      strokeColor={red=1,green=1,blue=1,alpha=0.9},
      frame={ x=1, y=drawTop + 1, w=frame.w-2, h=(drawH/2)-2 }
    }
  elseif rowMode == 3 then
    cv[#cv+1] = { type="rectangle", action="stroke", strokeWidth=3,
      strokeColor={red=1,green=1,blue=1,alpha=0.9},
      frame={ x=1, y=drawTop + (drawH/2)+1, w=frame.w-2, h=(drawH/2)-2 }
    }
  end

  -- selection highlight within the chosen row (if any)
  if selection and selection.leftPct and selection.rightPct then
    local leftPx = pctX(frame, selection.leftPct) - frame.x
    local rightPx = pctX(frame, selection.rightPct) - frame.x
    local y0, hh = drawTop, drawH
    if rowMode == 2 then
      y0, hh = drawTop, drawH/2
    elseif rowMode == 3 then
      y0, hh = drawTop + drawH/2, drawH/2
    end
    cv[#cv+1] = {
      type="rectangle", action="fill",
      fillColor={red=0.2, green=0.6, blue=1.0, alpha=0.25},
      frame={ x=leftPx, y=y0, w=(rightPx - leftPx), h=hh }
    }
    cv[#cv+1] = {
      type="rectangle", action="stroke", strokeWidth=3,
      strokeColor={red=0.2, green=0.6, blue=1.0, alpha=0.9},
      frame={ x=leftPx+1, y=y0+1, w=(rightPx - leftPx) - 2, h=hh - 2 }
    }
  end

  cv:show(0.1)
end

local function hideOverlays()
  for key, cv in pairs(overlays) do
    if type(cv.hide) == "function" then cv:hide(0) end
    if type(cv.delete) == "function" then cv:delete() end
    overlays[key] = nil
  end
  overlays = {}
end

-- ====== placement mode state ======
local state = {
  active = false,
  rowMode = 1,          -- 1 full; 2 top; 3 bottom
  map = {},             -- key -> {screen, profile, intervalIndex}
  firstKey = nil,       -- first interval selection
  timer = nil,          -- inactivity cancel timer
  overlayTimer = nil,   -- delayed overlay draw timer
  overlaySelection = nil, -- pending selection to highlight
  overlayShown = false, -- whether an overlay has been shown at least once
}

local function exitPlacementMode()
  state.active = false
  state.firstKey = nil
  if state.timer then state.timer:stop() state.timer = nil end
  if state.overlayTimer then state.overlayTimer:stop() state.overlayTimer = nil end
  state.overlaySelection = nil
  state.overlayShown = false
  hideOverlays()
  -- ensure the eventtap keeps running for next activations
  if tap and tap:isEnabled() == false then tap:start() end
end

-- Draw overlays immediately using current state.overlaySelection (no delay)
local function drawOverlaysNow()
  if not state.active then return end
  local seen = {}
  for _, v in pairs(state.map) do
    local uuid = v.screen:getUUID()
    if not seen[uuid] then
      local sel = nil
      if state.overlaySelection and v.screen:getUUID() == state.overlaySelection.screen:getUUID() then
        sel = { leftPct = state.overlaySelection.leftPct, rightPct = state.overlaySelection.rightPct }
      end
      makeOrShowOverlay(v.screen, v.profile, state.rowMode, sel)
      seen[uuid] = true
    end
  end
  state.overlayShown = true
end

local function beginPlacementMode(rowMode)
  -- if already active, reset cleanly first
  if state.active then
    exitPlacementMode()
  end
  state.rowMode = rowMode
  state.map = buildKeyMap()
  state.active = true
  state.firstKey = nil
  if state.timer then state.timer:stop() state.timer = nil end
  if state.overlayTimer then state.overlayTimer:stop() state.overlayTimer = nil end
  state.overlaySelection = nil
  state.overlayShown = false
  -- ensure tap is active
  if tap and tap:isEnabled() == false then tap:start() end

  -- delay initial overlay by 1s
  state.overlayTimer = hs.timer.doAfter(1.0, function()
    if state.active then
      drawOverlaysNow()
    end
  end)
end

-- key event tap while in placement mode
-- helper: reset inactivity timer
local function resetInactivityTimer()
  if state.timer then state.timer:stop() end
  state.timer = hs.timer.doAfter(5.0, function()
    if state.active then
      state.firstKey = nil
      exitPlacementMode()
    end
  end)
end

tap = hs.eventtap.new({ hs.eventtap.event.types.keyDown }, function(evt)
  if not state.active then return false end
  -- use keyCode so selection works even if modifiers are still held
  local keyName = keycodeToName[evt:getKeyCode()]
  if not keyName then return false end
  local ch = string.lower(keyName)

  if ch == "\27" or ch == "escape" then -- ESC by code or name
    exitPlacementMode(); return true
  end

  local info = state.map[ch]
  if not info then
    return false -- let unrelated keys pass through
  end

  -- sequential presses: keep an inactivity timeout while awaiting second key
  resetInactivityTimer()

  if not state.firstKey then
    state.firstKey = info
    -- redraw overlays to show the tentative selection left boundary
    local prof = info.profile
    local leftPct = prof.boundaries[info.intervalIndex]
    local rightPct = prof.boundaries[info.intervalIndex + 1]
    state.overlaySelection = { screen = info.screen, leftPct = leftPct, rightPct = rightPct }
    if state.overlayTimer then state.overlayTimer:stop() state.overlayTimer = nil end
    if state.overlayShown then
      -- overlay already visible: update immediately
      drawOverlaysNow()
    else
      -- overlay not yet visible: reset debounce timer
      state.overlayTimer = hs.timer.doAfter(1.0, function()
        if state.active then drawOverlaysNow() end
      end)
    end
    return true
  end

  -- both keys must be from the same monitor profile/screen; if not, treat this as a new first key
  if state.firstKey.screen:getUUID() ~= info.screen:getUUID() then
    state.firstKey = info
    -- schedule redraw for new screen selection
    local prof = info.profile
    local leftPct = prof.boundaries[info.intervalIndex]
    local rightPct = prof.boundaries[info.intervalIndex + 1]
    state.overlaySelection = { screen = info.screen, leftPct = leftPct, rightPct = rightPct }
    if state.overlayTimer then state.overlayTimer:stop() state.overlayTimer = nil end
    if state.overlayShown then
      -- overlay already visible: update immediately
      drawOverlaysNow()
    else
      -- overlay not yet visible: reset debounce timer
      state.overlayTimer = hs.timer.doAfter(1.0, function()
        if state.active then drawOverlaysNow() end
      end)
    end
    return true
  end

  local prof = info.profile
  local i1 = state.firstKey.intervalIndex
  local i2 = info.intervalIndex
  local leftIdx = math.min(i1, i2)
  local rightIdx = math.max(i1, i2)

  local leftPct  = prof.boundaries[leftIdx]
  local rightPct = prof.boundaries[rightIdx + 1] -- right edge of the chosen interval group

  local yPct, hPct
  if state.rowMode == 1 then
    yPct, hPct = 0, 100
  elseif state.rowMode == 2 then
    yPct, hPct = 0, 50
  else
    yPct, hPct = 50, 50
  end

  -- place window immediately without forcing an overlay draw

  moveWindowOnScreen(info.screen, leftPct, yPct, rightPct, hPct)
  exitPlacementMode()
  return true
end)
tap:start()

-- ====== hotkeys to show the grid ======
local hkTop, hkFull, hkBottom
hkTop   = hs.hotkey.bind(HYPER, "1", function() beginPlacementMode(2) end) -- top half
hkFull  = hs.hotkey.bind(HYPER, "2", function() beginPlacementMode(1) end) -- full height
hkBottom= hs.hotkey.bind(HYPER, "3", function() beginPlacementMode(3) end) -- bottom half

-- ====== quick help (optional) ======
hs.hotkey.bind(HYPER, "H", function()
  hs.alert.show(table.concat({
    "Placement mode:",
    "Hyper+2 full • Hyper+1 top • Hyper+3 bottom",
    "Then press TWO KEYS SEQUENTIALLY on the SAME monitor:",
    "Built-in: q w e r   (0-33-50-66-100)",
    "Mi:       1 2 3 4 5 6 (0-25-33-50-66-75-100)",
    "Sidecar:  z x c v   (0-33-50-66-100)",
    "Esc cancels."
  }, "\n"), 3)
end)
