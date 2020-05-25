// ==UserScript==
// @name				 LROverlay JS
// @namespace		http://tampermonkey.net/
// @version			0.4
// @description	Adds the ability to use LROverlay from within the linerider website
// @author			 Jack Bates (main UI interfacing created by David Lu)
// @match				https://www.linerider.com/*
// @match				https://*.official-linerider.com/*
// @match				http://localhost:8000/*
// @downloadURL	https://github.com/JbCoder/LROverlayJS/raw/master/LROverlay.js
// @grant				none
// ==/UserScript==

// jshint asi: true
// jshint esversion: 6


/* constants */
const SELECT_TOOL = 'SELECT_TOOL'
const EMPTY_SET = new Set()
const LINE_WIDTH = 2

/* actions */
const setTool = (tool) => ({
	type: 'SET_TOOL',
	payload: tool
})

const updateLines = (linesToRemove, linesToAdd) => ({
	type: 'UPDATE_LINES',
	payload: { linesToRemove, linesToAdd }
})

const setLines = (line) => updateLines(null, line)

const commitTrackChanges = () => ({
	type: 'COMMIT_TRACK_CHANGES'
})

const revertTrackChanges = () => ({
	type: 'REVERT_TRACK_CHANGES'
})

const setEditScene = (scene) => ({
	type: 'SET_RENDERER_SCENE',
	payload: { key: 'edit', scene }
})

/* selectors */
const getActiveTool = state => state.selectedTool
const getToolState = (state, toolId) => state.toolState[toolId]
const getSelectToolState = state => getToolState(state, SELECT_TOOL)
const getSimulatorCommittedTrack = state => state.simulator.committedEngine
const getEditorZoom = state => state.camera.editorZoom

class ScaleRotateMod {
	constructor (store, initState) {
		this.store = store

		this.changed = false
		this.state = initState

		this.track = getSimulatorCommittedTrack(this.store.getState())
		this.selectedPoints = EMPTY_SET

		store.subscribeImmediate(() => {
			this.onUpdate()
		})
	}

	commit () {
		if (this.changed) {
			this.store.dispatch(commitTrackChanges())
			this.store.dispatch(revertTrackChanges())
			this.store.dispatch(setEditScene(new Millions.Scene()))
			this.changed = false
			return true
		}
	}

	onUpdate (nextState = this.state) {
		let shouldUpdate = false

		if (this.state !== nextState) {
			this.state = nextState
			shouldUpdate = true
		}

		if (this.state.active) {
			const track = getSimulatorCommittedTrack(this.store.getState())
			if (this.track !== track) {
				this.track = track
				shouldUpdate = true
			}

			const selectToolState = getSelectToolState(this.store.getState())

			let selectedPoints = selectToolState.selectedPoints

			if (!selectToolState.multi) {
				selectedPoints = EMPTY_SET
			}

			if (!setsEqual(this.selectedPoints, selectedPoints)) {
				this.selectedPoints = selectedPoints
				shouldUpdate = true
			}
		}

		if (shouldUpdate) {
			if (this.changed) {
				this.store.dispatch(revertTrackChanges())
				this.store.dispatch(setEditScene(new Millions.Scene()))
				this.changed = false
			}

			if (this.state.active && this.selectedPoints.size > 0 && (this.state.scale !== 1 || this.state.scaleX !== 1 || this.state.scaleY !== 1 || this.state.rotate !== 0)) {
				const selectedLines = [...getLinesFromPoints(this.selectedPoints)]
					.map(id => this.track.getLine(id))
					.filter(l => l)

				const {x, y, width, height} = getBoundingBox(selectedLines)
				const c = new V2({
					x: x + width / 2,
					y: y + height / 2
				})

				const transform = this.getTransform()
				const transformedLines = []

				for (let line of selectedLines) {
					const p1 = new V2(line.p1).sub(c).transform(transform).add(c)
					const p2 = new V2(line.p2).sub(c).transform(transform).add(c)

					transformedLines.push({
						...line.toJSON(),
						x1: p1.x,
						y1: p1.y,
						x2: p2.x,
						y2: p2.y
					})
				}

				this.store.dispatch(setLines(transformedLines))

				const zoom = getEditorZoom(this.store.getState())
				const renderedBox = genBoxOutline(x, y, x + width, y + height, 1 / zoom, new Millions.Color(0, 0, 0, 255), 0)

				for (let line of renderedBox) {
					const p1 = new V2(line.p1).sub(c).transform(transform).add(c)
					const p2 = new V2(line.p2).sub(c).transform(transform).add(c)
					line.p1.x = p1.x
					line.p1.y = p1.y
					line.p2.x = p2.x
					line.p2.y = p2.y
				}
				this.store.dispatch(setEditScene(Millions.Scene.fromEntities(renderedBox)))
				this.changed = true
			}
		}
	}

	getTransform() {
		const transform = rotateTransform(this.state.rotate * Math.PI / 180)
		transform[0] *= this.state.scale
		transform[3] *= this.state.scale
		transform[0] *= this.state.scaleX
		transform[3] *= this.state.scaleY
		return transform
	}
}

function main () {
	const {
		React,
		store
	} = window

	const e = React.createElement

	class ScaleRotateModComponent extends React.Component {
		constructor (props) {
			super(props)

			this.state = {
				active: false,
				scale: 1,
				scaleX: 1,
				scaleY: 1,
				rotate: 0,
			}

			this.scaleRotateMod = new ScaleRotateMod(store, this.state)

			store.subscribe(() => {
				const selectToolActive = getActiveTool(store.getState()) === SELECT_TOOL

				if (this.state.active && !selectToolActive) {
					this.setState({ active: false })
				}
			})

			this.onCommit = () => {
				this.scaleRotateMod.commit()
				this.setState({
					scale: 1,
					scaleX: 1,
					scaleY: 1,
					rotate: 0
				})
			}
			this.onMouseCommit = () => {
				this.onCommit()
				window.removeEventListener('mouseup', this.onMouseCommit)
			}
			this.onKeyCommit = e => {
				if (e.key === 'Enter') {
					this.onCommit()
				}
			}
		}

		componentWillUpdate (nextProps, nextState) {
			this.scaleRotateMod.onUpdate(nextState)
		}

		onActivate () {
			if (this.state.active) {
				this.setState({ active: false })
			} else {
				store.dispatch(setTool(SELECT_TOOL))
				this.setState({ active: true })
				Lro()
			}
		}

		renderSlider (key, props) {
			props = {
				...props,
				value: this.state[key],
				onChange: e => this.setState({ [key]: parseFloatOrDefault(e.target.value) })
			}
			const rangeProps = {
				...props,
				onMouseDown: () => window.addEventListener('mouseup', this.onMouseCommit)
			}

			const numberProps = {
				...props,
				onKeyUp: this.onKeyCommit,
				onBlur: this.onCommit
			}
			return e('div', null,
				key,
				e('input', { style: { width: '3em' }, type: 'number', ...numberProps }),
				e('input', { type: 'range', ...rangeProps, onFocus: e => e.target.blur() })
			)
		}

		render () {
			return e('div',
				null,
				this.state.active && e('div', null,
					
					//this.renderSlider('scaleX', { min: 0, max: 2, step: 0.01 }),
					//this.renderSlider('scaleY', { min: 0, max: 2, step: 0.01 }),
					//this.renderSlider('scale', { min: 0, max: 2, step: 0.01 }),
					//this.renderSlider('rotate', { min: -180, max: 180, step: 1 })
				),
				e('button',
					{
						style: {
							backgroundColor: this.state.active ? 'lightblue' : null
						},
						onClick: this.onActivate.bind(this)
					},
					'LROverlay'
				)
			)
		}
	}

	// this is a setting and not a standalone tool because it extends the select tool
	window.registerCustomSetting(ScaleRotateModComponent)
}
trackData = [] 
function Lro() {
	var input = document.createElement('input');
	input.type = 'file';
	input.id = 'file-selector'
	input.onchange = e => { 
	
		 // getting a hold of the file reference
		 var file = e.target.files[0]; 
	
		 // setting up the reader
		 const reader = new FileReader();
		 // Load Image File and Generate Canvas data
			reader.addEventListener('load', event => {
				var output = document.createElement('img');
				output.src = event.target.result;
				output.id = 'output'
				console.log(output)
				document.body.appendChild(output)
				//document.getElementById('body').appendChild(output);
				//var output = document.createElement('img')
				//output.id = 'output'
				console.log(document.getElementById('output'))
				console.log(event.target.result);

				var img = document.getElementById('output');
				sleep(2000)
				var canvas = document.createElement('canvas');
				canvas.id = "canvas"
				
				//sleep(1000)
				document.body.appendChild(canvas)
				sleep(1000)

				var canvas = document.getElementById("canvas")
				canvas.width = img.width;
				canvas.height = img.height;
				var context = canvas.getContext('2d');
				
				
				
				context.drawImage(img, 0, 0 );
				console.log(context)
				console.log(canvas)
				var myData = context.getImageData(0, 0, img.width, img.height);
				var rgb_data = myData
				//console.log(rgb_data)
				//console.log(GetPixel(rgb_data,0,0))

				document.body.removeChild(output)
				document.body.removeChild(canvas)
				window.trackData = []
				// Main Calls
				ditherImage(rgb_data)
				//console.log(trackData)
				store.dispatch(setLines(trackData))
				store.dispatch(commitTrackChanges())
				//var p = document.createElement("p")
    			//document.body.appendChild(p)
    			//p.innerHTML = trackData
    			//contourImage(rgb_data)
			});
			reader.readAsDataURL(file);
	}

input.click();
}
/* LROverlay Functions */ 
function GetPixel(data,x,y){
	// Get a specific pixel using (x,y) coords instead of flat Canvas list [r,g,b,a,r,g,b,a...]
	index = y * (data.width * 4) + x * 4
	var values = [
		data.data[index],
		data.data[index+1],
		data.data[index+2]
		]
	return values
}

function sleep(milliseconds) {
  const date = Date.now();
  let currentDate = null;
  do {
    currentDate = Date.now();
  } while (currentDate - date < milliseconds);
}

function ditherImage(rgb_data){
    var greyscale_data = []
    for (var x = 0; x < rgb_data.width; x++){
    	for (var y = 0; y < rgb_data.height; y++){
    		var pixel = GetPixel(rgb_data,x,y)
    		greyscale_data[(x*rgb_data.width)+(y)] = (pixel[0] + pixel[1] + pixel[2])/3
    		//console.log((pixel[0] + pixel[1] + pixel[2])/3)
    		//rgb_data.data[(x*data.width)+(y*data.height)+1] = (pixel[0] + pixel[1] + pixel[2])/3
       	
       	}
    }
    window.data_height = rgb_data.height
    window.data_width = rgb_data.width
    console.log(greyscale_data.length)
    //frame=Image.open(file).convert("1")
    floyd_result = floydSteinberg(greyscale_data,rgb_data.width,rgb_data.height)
    
    toLines(floyd_result,rgb_data.width,rgb_data.height)
}
function toLines(frame,width,height){
    console.log("Converting image to lines...")
    var linecount = 0
    var sourceCanvas = frame
    console.log(frame)
    var x1=null,y1=null,x2=null,y2=null
    var ls=false,lf=false
    for (var y = 0; y < height; y++){
        if (lf==true){
            frame[(x*width)+(y-1)]=0
            linecount+=1
            createLine(linecount,x1,y1,x2+0.1,y2)
        }
        var x1=null,y1=null,x2=null,y2=null
        ls=false,lf=false
        for (var x = 0; x < width; x++){
            if (frame[(x*width)+(y)]>0){
                if (lf==true){
                    frame[((x-1)*width)+(y)]=0
                    linecount+=1
                    createLine(linecount,x1,y1,x2+0.1,y2)
                }
                var x1=null,y1=null,x2=null,y2=null
                ls=false,lf=false
            }
            if (frame[(x*width)+(y)]==0){
                if (ls==true){
                    x2=x,y2=y
                    frame[(x*width)+y]=1
                    lf=true
                }
                if (ls==false){
                    x1=x,y1=y,x2=x,y2=y
                    ls=true
                }
            }
        }
    }
    for (var x = 0; x < width; x++){
            if (lf==true){
                linecount+=1
                createLine(linecount,x1,y1,x2,y2+0.1)
            }
            var x1=null,y1=null,x2=null,y2=null
            ls=false,lf=false
            for (var y = 0; y < height; y++){
                if (frame[(x*width)+(y)]<=1){
                    if (ls==true){
                        x2=x,y2=y
                        lf=true
                    }
                    if (ls==false){
                        x1=x,y1=y,x2=x,y2=y
                        ls=true
                    }
                }
                if (frame[(x*width)+(y)]>1){
                    if (lf==true){
                        linecount+=1
                        createLine(linecount,x1,y1,x2,y2+0.1)
                    }
                    var x1=null,y1=null,x2=null,y2=null
                    ls=false,lf=false
                }
            }

    }
    console.log("Generated "+linecount+" lines...")

}

function createLine(idno,x1,y1,x2,y2){
	var x1=x1*2
    var y1=y1*2
    var x2=x2*2
    var y2=y2*2
    var type = 2
    var newLine={"x1":parseInt(x1),"y1":parseInt(y1),"x2":parseInt(x2),"y2":parseInt(y2),type}
    //if (y1 != 0 && y2 != data_height*2){
    	window.trackData.push(newLine)
	//}
    //console.log(newLine)
}

function floydSteinberg(sb, w, h)   // source buffer, width, height
{
   for(var i=0; i<h; i++)
      for(var j=0; j<w; j++)
      {
         var ci = i*w+j;               // current buffer index
         var cc = sb[ci];              // current color
         var rc = (cc<128?0:255);      // real (rounded) color
         var err = cc-rc;              // error amount
         sb[ci] = rc;
         ///*                  // saving real color
         if(j+1<w) sb[ci  +1] += (err*7)>>4;  // if right neighbour exists
         if(i+1==h) continue;   // if we are in the last line
         if(j  >0) sb[ci+w-1] += (err*3)>>4;  // bottom left neighbour
                   sb[ci+w  ] += (err*5)>>4;  // bottom neighbour
         if(j+1<w) sb[ci+w+1] += (err*1)>>4;  // bottom right neighbour
      	//*/
      }

    return sb
}

/* init */
if (window.registerCustomSetting) {
	main()
} else {
	const prevCb = window.onCustomToolsApiReady
	window.onCustomToolsApiReady = () => {
		if (prevCb) prevCb()
		main()
	}
}

/* utils */
function setsEqual (a, b) {
	if (a === b) {
		return true
	}
	if (a.size !== b.size) {
		return false
	}
	for (let x of a) {
		if (!b.has(x)) {
			return false
		}
	}
	return true
}

function getLinesFromPoints (points) {
	return new Set([...points].map(point => point >> 1))
}

function rotateTransform (rads) {
	const { V2 } = window

	let u = V2.from(1, 0).rot(rads)
	let v = V2.from(0, 1).rot(rads)

	return [u.x, v.x, u.y, v.y, 0, 0]
}

function parseFloatOrDefault (string, defaultValue = 0) {
	const x = parseFloat(string)
	return isNaN(x) ? defaultValue : x
}

function getBoundingBox (lines) {
	if (lines.size === 0) {
		return {
			x: 0,
			y: 0,
			width: 0,
			height: 0
		}
	}
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity

	for (let line of lines) {
		minX = Math.min(line.p1.x, minX)
		minY = Math.min(line.p1.y, minY)
		maxX = Math.max(line.p1.x, maxX)
		maxY = Math.max(line.p1.y, maxY)

		minX = Math.min(line.p2.x, minX)
		minY = Math.min(line.p2.y, minY)
		maxX = Math.max(line.p2.x, maxX)
		maxY = Math.max(line.p2.y, maxY)
	}

	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY
	}
}

function genLine (x1, y1, x2, y2, thickness, color, zIndex) {
	let p1 = {
		x: x1,
		y: y1,
		colorA: color,
		colorB: color,
		thickness
	}
	let p2 = {
		x: x2,
		y: y2,
		colorA: color,
		colorB: color,
		thickness
	}
	return new Millions.Line(p1, p2, 3, zIndex)
}


function genBoxOutline (x1, y1, x2, y2, thickness, color, zIndex) {
	return [
		genLine(x1, y1, x1, y2, thickness, color, zIndex),
		genLine(x1, y2, x2, y2, thickness, color, zIndex + 0.1),
		genLine(x2, y2, x2, y1, thickness, color, zIndex + 0.2),
		genLine(x2, y1, x1, y1, thickness, color, zIndex + 0.3)
	]
}
