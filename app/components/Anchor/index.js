import React from "react";
import {shell} from "electron";
import "./index.scss";
import {getSafeExternalUrl} from '../../utils/urlPolicy';

export default function Anchor(props) {
  const {
    href = '',
    children,
  } = props;

  const open = () => {
    const safeUrl = getSafeExternalUrl(href);
    if (safeUrl) {
      shell.openExternal(safeUrl);
    }
  };

  return (
    <a
      className="anchor"
      onClick={open}
    >
      {children}
    </a>
  )
}
