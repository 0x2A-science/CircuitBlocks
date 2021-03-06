import React, {RefObject} from 'react';
import { editor as monacoTypes } from 'monaco-editor';
import MonacoEditor from 'react-monaco-editor';

interface Props {
  code?: string;
  ref?: React.RefObject<typeof monacoTypes>;
  theme?: string;
  editing?: boolean;
  startCode?: string;
  sketch?: string;
}

class Monaco extends React.Component<Props> {
  private monacoRef: RefObject<MonacoEditor>;

  constructor(props: Props){
    super(props);

    this.monacoRef = React.createRef();
  }

  componentWillUpdate(nextProps: Readonly<Props>, nextState: Readonly<any>, nextContext: any): void {
    if(this.props.startCode != nextProps.startCode){
      this.setCode(nextProps.startCode ? nextProps.startCode : "");
    }
  }

  editorDidMount(editor: monacoTypes.IStandaloneCodeEditor/*, monaco: any*/) {
    if(!this.props.editing) return;
    editor.setValue(this.props.startCode ? this.props.startCode : "");
  }

  public getCode(){
    if(this.monacoRef.current == undefined || this.monacoRef.current.editor == null) return "";
    return this.monacoRef.current.editor.getValue();
  }

  public setCode(value: string){
    if(this.monacoRef.current == undefined || this.monacoRef.current.editor == null) return "";
    return this.monacoRef.current.editor.setValue(value);
  }

  render() {
    const { theme, editing, code } = this.props;

    const options: monacoTypes.IEditorConstructionOptions = {
      selectOnLineNumbers: true,
      readOnly: !editing,
      fontFamily: 'Source Code Pro',
      fontWeight: '400',
      fontSize: 13,
      minimap: {
        enabled: false
      },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderIndentGuides: true
    };

    return (
      <MonacoEditor
        language="cpp"
        theme={theme ? theme : 'vs-dark'}
        height="90%"
        value={code}
        options={options}
        editorDidMount={ (editor) => { this.editorDidMount(editor); }}
        ref={this.monacoRef}
      />
    );
  }
}

export default Monaco;
