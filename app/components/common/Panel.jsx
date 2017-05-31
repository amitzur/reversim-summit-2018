import React from 'react';
import classnames from 'classnames/bind';
import styles from 'css/common/layout.css';

const cx = classnames.bind(styles);

export default (props) => {
  const { vertical, children, spacing, className, style, even } = props;
  return (
    <div className={cx("panel", { vertical }, className, { even })} style={style}>
      { React.Children.map(children, c => {
        return React.cloneElement(c, { style: { ...c.props.style, marginRight: spacing } });
      })}
    </div>
  );
};
