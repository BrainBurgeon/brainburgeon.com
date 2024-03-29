const allowedFileTypes = [
  'application/vnd.ms-excel', 
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

Vue.createApp({
  data: () => ({
    version: window.config.version,
    loaded: true,
    files: {
      A: {},
      B: {},
    },
  }),
  components: {
    Excel: {
      data: () => ({
        isHighlighted: false,
        selectedSheetName: null,
        selectedSheetJson: null,
      }),
      props: {
        label: {
          type: String,
          required: true,
        }
      },
      methods: {
        reset() {
          this.deselectSheet()
          this.deselectCell()
        },

        handleDragover(e) {
          this.isHighlighted = true
        },

        handleDrop(e) {
          this.isHighlighted = false
          const fileList = e.dataTransfer.files
          if(fileList.length > 1) {
            return alert('Please only drop 1 file at a time.')
          }
          this.reset()
          this.getMetadataForFile(fileList[0])
        },

        handleDragleave() {
          this.isHighlighted = false
        },

        getMetadataForFile(file) {
          const meta = {
            name: file.name ? file.name : 'NOT SUPPORTED',
            type: file.type ? file.type : 'NOT SUPPORTED',
            size: file.size ? file.size : 'NOT SUPPORTED',
          }

          if (!allowedFileTypes.includes(meta.type)) {
            console.error(meta)
            return alert('Unsupported file type.')
          }

          this.$root.files[this.label].meta = meta
          this.readFile(file)
        },

        readFile(file) {
          const reader = new FileReader()
          reader.addEventListener('load', (e) => {
            this.parse(e.target.result)
          })
          reader.readAsDataURL(file)
        },

        parse(data) {
          const base64Data = data.split('base64,')[1]
          const parsed = XLSX.read(base64Data, {
            type: 'base64',
          })
          this.$root.files[this.label].parsed = parsed
          // if there's only 1 sheet, auto select it
          if (parsed.SheetNames.length === 1) {
            this.selectSheet(parsed.SheetNames[0])
          }
        },

        selectSheet(sheetName) {
          const selectedSheet = this.$root.files[this.label].parsed.Sheets[sheetName]
          const JSON = XLSX.utils.sheet_to_json(selectedSheet, { header: 1, defval: '' })
          this.$root.files[this.label].selectedSheet = selectedSheet
          this.selectedSheetName = sheetName
          this.selectedSheetJson = JSON
        },

        deselectSheet() {
          this.$root.files[this.label].selectedSheet = null
          this.selectedSheetName = null
          this.selectedSheetJson = null
        },

        selectCell(r, c) {
          this.$root.files[this.label].selectedCell = { r, c }
        },

        deselectCell() {
          this.$root.files[this.label].selectedCell = null
        },

        encodeCell(cell) {
          return XLSX.utils.encode_cell(cell)
        },
      },
      template: `
        <div
          :class="{ 'drop-area': true, 'drop-highlight': isHighlighted }" 
          @dragover.stop.prevent="handleDragover" 
          @drop.stop.prevent="handleDrop" 
          @dragleave="handleDragleave"
          :data-label="label"
        >
          <div v-if="$root.files[label].parsed">
            <h3>{{$root.files[label].meta.name}}</h3>

            <div v-if="selectedSheetJson">
              <div v-if="$root.files[label].selectedCell">
                <button type="button" @click="deselectCell">back</button>
                <p>Selected cell: {{encodeCell($root.files[label].selectedCell)}}</p>
              </div>
              <div v-else>
                <button type="button" @click="deselectSheet">back</button>
                <p>Selected sheet: {{selectedSheetName}}</p>
                <p>Select a cell to compare:</p>
                <table>
                  <tbody>
                    <tr v-for="(row, rowIdx) in selectedSheetJson" :key="'row'+rowIdx">
                      <td v-for="(cell, colIdx) in row" :key="'col'+colIdx" @click="selectCell(rowIdx, colIdx)">{{cell}}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div v-else>
              <p>Select a sheet:</p>
              <ul class="sheetSelector">
                <li v-for="sheetName in $root.files[label].parsed.SheetNames" :key="sheetName" @click="selectSheet(sheetName)">{{sheetName}}</li>
              </ul>
            </div>
          </div>
          <div v-else class="placeholder">
            {{label}}
          </div>
        </div>`
    },

    Diff: {
      data: () => ({
        diffA: null,
        diffB: null,
        defval: '[empty]',
      }),
      props: {
        file_a: {
          type: Object,
          required: true,
        },
        file_b: {
          type: Object,
          required: true,
        },
      },
      methods: {
        getCol(file) {
          const colName = XLSX.utils.encode_col(file.selectedCell.c)
          const rangeDecoded = XLSX.utils.decode_range(file.selectedSheet['!ref'])
          const range = `${colName}${file.selectedCell.r + 1}:${colName}${rangeDecoded.e.r + 1}`
          const col = XLSX.utils.sheet_to_json(file.selectedSheet, { range, header: 1, defval: this.defval })
          return col
        },

        diffUnique(arrA, arrB) {
          // items missing from B
          let diffA = []

          // items missign from A
          let diffB = arrB.filter(v => v !== this.defval)

          arrA.forEach(a => {
            if (a !== this.defval) {
              const idx = diffB.indexOf(a)
              if (idx > -1) {
                diffB.splice(idx, 1)
              }
              else {
                diffA.push(a)
              }
            }
          })
          
          return [diffA, diffB]
        },

        singPlu(amount, singular, plural) {
          return amount === 1 ? singular : plural
        },

        now() {
          const d = new Date()
          const n = ['getFullYear', 'getMonth', 'getDate', 'getHours', 'getMinutes', 'getSeconds']
          return n.map(fn => {
            let v = d[fn]()
            if (fn === 'getMonth') v += 1
            return String(v).padStart(2, '0')
          }).join('')
        },

        getCSVfilename(filename) {
          return filename + '__diffy__' + this.now() + '.csv'
        },

        getCSVdata(diff) {
          const csv = diff.map(val => `"${val}"`).join('\n')
          return 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
        },
      },
      mounted() {
        const colA = this.getCol(this.file_a).map(val => val[0])
        const colB = this.getCol(this.file_b).map(val => val[0])

        const [diffA, diffB] = this.diffUnique(colA, colB)

        this.diffA = diffA
        this.diffB = diffB
      },
      template: `
      <div v-if="diffA" class="result-area">
        <h3>{{file_a.meta.name}}</h3>
        <p>{{diffA.length}} {{singPlu(diffA.length, 'item', 'items')}} missing from B:</p>
        <div><a :href="getCSVdata(diffA)" :download="getCSVfilename(file_a.meta.name)">download CSV</a></div>
        <pre>{{diffA}}</pre>
      </div>
      <div v-if="diffB" class="result-area">
        <h3>{{file_b.meta.name}}</h3>
        <p>{{diffB.length}} {{singPlu(diffB.length, 'item', 'items')}} missing from A:</p>
        <div><a :href="getCSVdata(diffB)" :download="getCSVfilename(file_b.meta.name)">download CSV</a></div>
        <pre>{{diffB}}</pre>
      </div>
      `
    }
  }
}).mount('#app')
